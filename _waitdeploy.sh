#!/bin/bash
# Deploy detector: poll the served CSS bundle for `ms-orbital`, a class that exists ONLY in the
# new build. Polling the page HTML would not work — the earnings panels mount client-side after
# an event is selected, so their classes never appear in the initial document.
for i in $(seq 1 60); do
  HTML=$(curl -s --max-time 25 https://blackouttrades.com/meridian 2>/dev/null)
  CSSURL=$(printf '%s' "$HTML" | grep -o '/_next/static/css/[a-z0-9]*\.css' | head -1)
  if [ -n "$CSSURL" ]; then
    if curl -s --max-time 25 "https://blackouttrades.com$CSSURL" 2>/dev/null | grep -q "ms-orbital"; then
      echo "DEPLOYED after $((i*30))s — bundle $CSSURL carries ms-orbital"
      exit 0
    fi
  fi
  sleep 30
done
echo "TIMEOUT — new bundle not detected after 30min"
exit 1
