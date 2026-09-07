# RTH-open holiday skip spurious retry — FIXED

> **kind:** FINDING

## Symptom

After #4523 taught `rth-open-check.mjs` to pass on `ok+skipped` holiday payloads, the harness still logged:

`⚠ options-socket (attempt 1/3): HTTP 200 — retrying…`

before succeeding on attempt 2. `validate:rth-open` stayed GREEN but the retry noise was misleading.

## Root cause

The `else` branch handling bare HTTP status (no `websockets.options`) was chained to `if (!socketProbeOk && opt)`. When `isSocketHealthSkipped()` set `socketProbeOk = true` with no `opt`, control fell through to `else { probe HTTP ${status} }` anyway.

## Fix

Guard the 401 and generic HTTP branches with `!socketProbeOk` so a satisfied holiday skip does not enter the retry path.

| **Status** | FIXED in `fix/rth-open-holiday-skip-no-spurious-retry` |
