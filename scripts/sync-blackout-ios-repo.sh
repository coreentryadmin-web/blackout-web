#!/usr/bin/env bash
# Mirror apps/blackout-ios → standalone blackout-ios GitHub repo (when you have push access).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/apps/blackout-ios"
DEST="${1:-$ROOT/../blackout-ios}"

if [[ ! -d "$SRC" ]]; then
  echo "Missing $SRC"
  exit 1
fi

rsync -av --delete \
  --exclude node_modules \
  --exclude ios \
  --exclude .git \
  "$SRC/" "$DEST/"

echo "Synced to $DEST — cd there and: git add -A && git commit -m 'sync from blackout-web' && git push"
