# Cron audit `query` — swing-discovery false P0 at OVERNIGHT phase start

> **kind:** FINDING

| **Status** | FIXED (pending merge) |

## Symptom

`query` CI on `main` @ `1f445e923` (2026-11-10 01:25 UTC / **20:25 ET** Mon): `problems: swing-discovery` only.

## Root cause

`swing-discovery` is phase-anchored (POST_CLOSE then OVERNIGHT, etc.). The cron watchdog treats `stale`/`failed` from the **prior** phase as actionable immediately when a new phase window opens. At 20:25 ET the OVERNIGHT window had been open 25m while EventBridge ticks are ~30m spaced — `cron-audit-query` P0'd before the first in-window handshake could land, even though serving-snapshot probe / in-flight claim may still be resolving POST_CLOSE.

## Fix

`evaluateJob()`: first **45 minutes** after `resolveScanPhase()` enters a window, suppress `stale`/`failed` for `swing-discovery` (same posture as off-schedule idle gaps).

## Verify

- `admin-cron-health.test.ts` at 20:25 ET failed POST_CLOSE row → `healthy`.
- Post-merge: `query` CI on next schedule should clear when only swing-discovery was in this shape.
