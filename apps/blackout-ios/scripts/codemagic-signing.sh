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

# One-shot fetch/create (cert + profile). Generates a key if none exists.
if ! app-store-connect certificates list --type IOS_DISTRIBUTION 2>/dev/null | grep -q IOS_DISTRIBUTION; then
  echo "No IOS_DISTRIBUTION certificate — creating via fetch-signing-files --create"
  export CERTIFICATE_PRIVATE_KEY="$(openssl genrsa 2048 2>/dev/null)"
fi

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
