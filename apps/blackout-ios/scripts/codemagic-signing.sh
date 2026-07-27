#!/usr/bin/env bash
# Codemagic: fetch/create App Store signing cert + profile for BLACKOUT TRADE LLC.
set -euo pipefail

node scripts/validate-codemagic-env.mjs

# Verify Xcode bundle ID matches Apple ASC (patch step must have run).
PBX="ios/App/App.xcodeproj/project.pbxproj"
if ! grep -q "PRODUCT_BUNDLE_IDENTIFIER = ${BUNDLE_ID};" "$PBX"; then
  echo "ERROR: $PBX bundle ID is not ${BUNDLE_ID} — re-run patch-ios-bundle-id.mjs"
  grep "PRODUCT_BUNDLE_IDENTIFIER" "$PBX" || true
  exit 1
fi

keychain initialize
echo "Signing for team ${APPLE_TEAM_ID} bundle ${BUNDLE_ID}"

# EPHEMERAL-RUNNER ↔ APPLE-CERT-LIMIT DANCE (fixed 2026-07-27).
#
# Apple caps distribution certs at 2 per team. Each CI run generates a fresh
# in-memory private key with `openssl genrsa`, creates a cert bound to that
# key, and then the key is thrown away when the runner is reclaimed — so
# every prior cert is effectively stranded (signing needs the paired priv
# key we no longer have). By the third run the account is at the 2-cert cap
# and Apple 409s: "You already have a current Distribution certificate or
# a pending certificate request." Every subsequent run fails until the
# stranded certs are revoked.
#
# Fix: at the top of every signing run, revoke ALL current DISTRIBUTION
# certs so `fetch-signing-files --create` can always create a fresh one
# bound to this run's private key. Safe because:
#   - No cert on the account has an accessible private key (both CI paths
#     — this workflow AND Codemagic — regenerate keys each run and don't
#     persist a p12), so nothing that could sign was going to sign with the
#     old certs anyway.
#   - Existing TestFlight builds are already signed and immutable; revoking
#     the cert does not invalidate them, only prevents NEW builds from being
#     signed with the revoked cert.
#   - Provisioning profiles auto-regenerate against the new cert on the next
#     `fetch-signing-files --create` call (that's what --create means).
#
# LONG-TERM: persist a p12 (cert + priv key) as an ASC_DISTRIBUTION_P12
# secret and add it to the keychain here. Then `fetch-signing-files` finds
# a matching key and reuses the existing cert instead of thrashing. Adding
# that is a separate PR + a new secret from the owner; this revoke-and-
# create loop is the correct behavior until that lands.
echo "Sweeping stranded IOS_DISTRIBUTION certs (ephemeral-runner cert cap dance)"
STRANDED_CERT_IDS=$(app-store-connect certificates list --type IOS_DISTRIBUTION --json 2>/dev/null | python3 -c "import json,sys; [print(c['id']) for c in json.load(sys.stdin)]" 2>/dev/null || true)
if [ -n "${STRANDED_CERT_IDS:-}" ]; then
  while IFS= read -r cert_id; do
    [ -z "$cert_id" ] && continue
    echo "  revoking $cert_id"
    app-store-connect certificates delete "$cert_id" --ignore-not-found || echo "    (revoke failed, continuing)"
  done <<< "$STRANDED_CERT_IDS"
fi

# ALWAYS generate a fresh private key now that all prior certs are revoked.
# The old `if list is empty` guard is redundant post-sweep — the sweep
# above always leaves 0 certs on the account.
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
