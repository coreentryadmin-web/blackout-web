#!/usr/bin/env bash
# Codemagic: fetch/create App Store signing cert + profile for BLACKOUT TRADE LLC.
#
# Shared between the Capacitor WebView shell (apps/blackout-ios) and the
# native SwiftUI app (apps/blackout-ios-native). Both apps target the SAME
# bundle id (`com.blackout-trades.app`) + team, so a SINGLE distribution
# cert + provisioning profile serves both. What differs is where the
# generated Xcode project sits:
#   - WebView shell: ios/App/App.xcodeproj/project.pbxproj (Capacitor)
#   - Native app:    BlackOut.xcodeproj/project.pbxproj    (XcodeGen)
# The caller sets PBX_PATH to the correct path; env-var defaulting keeps
# the existing WebView TestFlight workflow working without changes.
#
# CALLER ENV CONTRACT:
#   BUNDLE_ID           the com.* bundle to sign for (both apps use the same)
#   APPLE_TEAM_ID       the developer team id
#   PBX_PATH (opt)      path to the pbxproj to sanity-check bundle id in;
#                       defaults to the Capacitor path for backwards compat
#   SKIP_VALIDATE_ENV   set to 1 to skip validate-codemagic-env.mjs (used by
#                       the native workflow — the validator is Capacitor-
#                       specific; native has its own preflight checks)
set -euo pipefail

if [ "${SKIP_VALIDATE_ENV:-0}" != "1" ]; then
  node scripts/validate-codemagic-env.mjs
fi

# Verify Xcode bundle ID matches Apple ASC (patch step must have run).
PBX="${PBX_PATH:-ios/App/App.xcodeproj/project.pbxproj}"
if ! grep -q "PRODUCT_BUNDLE_IDENTIFIER = ${BUNDLE_ID};" "$PBX"; then
  echo "ERROR: $PBX bundle ID is not ${BUNDLE_ID} — re-run the bundle-id patch step or verify project.yml"
  grep "PRODUCT_BUNDLE_IDENTIFIER" "$PBX" || true
  exit 1
fi

keychain initialize
echo "Signing for team ${APPLE_TEAM_ID} bundle ${BUNDLE_ID}"

# EPHEMERAL-RUNNER ↔ APPLE-CERT-LIMIT DANCE (fixed 2026-07-27).
#
# Apple caps distribution certs at 2 per team. Each CI run generates a fresh
# in-memory private key with `openssl genrsa`, creates a cert bound to that
# key, then the key is thrown away when the runner is reclaimed. Every prior
# cert is effectively stranded (signing needs the paired priv key we no
# longer have). At the 2-cert cap Apple 409s the next --create.
#
# We revoke stranded certs by hitting the ASC API directly with curl + a
# freshly-signed ES256 JWT. Doing it via the ASC API instead of
# codemagic-cli-tools' certificates subcommand for THREE reasons:
#   1. Version-agnostic — the tool's subcommand names + flags drift across
#      releases. The ASC API is a stable public contract.
#   2. Loud errors — a curl 4xx is visible in logs; a silently-empty parse
#      is not (this bit us on run 30240520955: the list --json parse failed
#      quietly and the sweep skipped, so the cap never came unstuck).
#   3. Zero extra deps — python3 + curl are guaranteed on the macos-14
#      runner.
#
# Safe to revoke because:
#   - No cert on the account has an accessible private key (both CI paths
#     regenerate keys each run and don't persist a p12), so nothing that
#     could sign was going to sign with the old certs anyway.
#   - Existing TestFlight builds are already signed + immutable; revoking
#     the cert does not invalidate them.
#   - Provisioning profiles auto-regenerate against the new cert on the
#     next fetch-signing-files --create call.
#
# LONG-TERM: persist a p12 (cert + priv key) as an ASC_DISTRIBUTION_P12
# secret and add it to the keychain here. Then fetch-signing-files finds a
# matching key and reuses the existing cert instead of thrashing. Adding
# that is a separate PR + a new secret from the owner.
echo "Sweeping stranded IOS_DISTRIBUTION certs via ASC API"
python3 - <<'PY'
import base64, json, os, sys, time, urllib.request, urllib.error

# Build an ES256 JWT the same way the App Store Connect tools do — 20-minute
# lifetime, aud=appstoreconnect-v1, iss=our issuer id. `pip install cryptography`
# is guaranteed because codemagic-cli-tools depends on it (already installed
# in the earlier "pip3 install codemagic-cli-tools" step).
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature

def b64u(b): return base64.urlsafe_b64encode(b).rstrip(b"=").decode()

issuer = os.environ["APP_STORE_CONNECT_ISSUER_ID"]
key_id = os.environ["APP_STORE_CONNECT_KEY_IDENTIFIER"]
pem    = os.environ["APP_STORE_CONNECT_PRIVATE_KEY"].encode()

header  = {"alg": "ES256", "kid": key_id, "typ": "JWT"}
payload = {"iss": issuer, "exp": int(time.time()) + 1200, "aud": "appstoreconnect-v1"}
signing = f"{b64u(json.dumps(header, separators=(',', ':')).encode())}." \
          f"{b64u(json.dumps(payload, separators=(',', ':')).encode())}"

pk = serialization.load_pem_private_key(pem, password=None)
raw = pk.sign(signing.encode(), ec.ECDSA(hashes.SHA256()))
r, s = decode_dss_signature(raw)
sig = r.to_bytes(32, "big") + s.to_bytes(32, "big")
jwt = f"{signing}.{b64u(sig)}"

BASE = "https://api.appstoreconnect.apple.com/v1"
HEADERS = {"Authorization": f"Bearer {jwt}"}

def api(method, path, body=None):
    url = BASE + path
    req = urllib.request.Request(url, method=method, headers=HEADERS,
                                 data=json.dumps(body).encode() if body else None)
    if body: req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, (r.read().decode() if method != "DELETE" else "")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()

# List all DISTRIBUTION certs (covers both IOS_DISTRIBUTION and DISTRIBUTION
# type strings — Apple has both, and filter=IOS_DISTRIBUTION only matches
# one of them). We revoke everything so the next --create always has room.
status, body = api("GET", "/certificates?filter[certificateType]=DISTRIBUTION,IOS_DISTRIBUTION&limit=200")
if status != 200:
    print(f"  ! list failed ({status}): {body[:400]}", file=sys.stderr)
    sys.exit(0)  # non-fatal — let fetch-signing-files surface any real cap issue

certs = json.loads(body).get("data", [])
print(f"  found {len(certs)} distribution cert(s) on the account")
if not certs:
    sys.exit(0)

kept, revoked, failed = 0, 0, 0
for c in certs:
    cid = c["id"]
    name = c.get("attributes", {}).get("name", "")
    st, resp = api("DELETE", f"/certificates/{cid}")
    if st in (204, 200):
        print(f"    revoked {cid}  {name}")
        revoked += 1
    elif st == 404:
        print(f"    already gone {cid}")
        revoked += 1
    else:
        print(f"    ! DELETE {cid} → HTTP {st}: {resp[:200]}", file=sys.stderr)
        failed += 1

print(f"  swept: {revoked} revoked, {failed} failed")
PY

# Always generate a fresh private key now that all prior certs are gone.
echo "Generating fresh private key for the new certificate"
export CERTIFICATE_PRIVATE_KEY="$(openssl genrsa 2048 2>/dev/null)"

app-store-connect fetch-signing-files "$BUNDLE_ID" \
  --type IOS_APP_STORE \
  --platform IOS \
  --create \
  --strict-match-identifier \
  --verbose

keychain add-certificates
xcode-project use-profiles

# Xcode 15+ on GitHub Actions macOS runners reads provisioning profiles ONLY
# from ~/Library/MobileDevice/Provisioning Profiles/. codemagic-cli-tools
# saves them to the legacy ~/Library/Developer/Xcode/UserData/Provisioning
# Profiles/ path, so xcodebuild fails the archive with "No profile for team
# 'ZA32C782N5' matching 'BlackOut ios_app_store <ts>' found" even though the
# profile was created and use-profiles configured the pbxproj. Copy them
# across so both search paths resolve the same file.
LEGACY="$HOME/Library/Developer/Xcode/UserData/Provisioning Profiles"
MODERN="$HOME/Library/MobileDevice/Provisioning Profiles"
if [ -d "$LEGACY" ]; then
  mkdir -p "$MODERN"
  # -n so we never clobber an existing profile with the same filename (e.g.
  # if the runner is warm from a prior run); cp -R with a glob would blow up
  # if the source dir is empty, so shell-glob-guard with `shopt -s nullglob`.
  shopt -s nullglob
  for f in "$LEGACY"/*.mobileprovision "$LEGACY"/*.provisionprofile; do
    cp -n "$f" "$MODERN/" && echo "  installed $(basename "$f")"
  done
  shopt -u nullglob
fi

echo "Code signing ready."
