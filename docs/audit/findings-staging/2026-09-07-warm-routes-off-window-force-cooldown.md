# Sibling warm routes missing off-window force=1 cooldown — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **ID** | BO-P1-0104 |
| **Severity** | P1 |
| **Area** | cron / perf / cache warmers |
| **Status** | FIXED in PR (fix/warm-routes-off-window-cooldown) |

## Symptom

PR #4558 hardened `desk-warm` so repeated `?force=1` calls **outside** the extended warm window use a 300s cooldown instead of the in-window 60s floor. The PR's blast-radius note called out the same latent gap on `heatmap-warm`, `zerodte-warm`, and `meridian-warm` — all share the identical `force=1` + flat `RERUN_COOLDOWN_KEY` pattern.

## Root cause

Those three routes applied a flat in-window cooldown regardless of `isEtExtendedWarmHours()`, so an external caller hammering `?force=1` off-hours faced the same throttle as a legitimate in-window dispatcher.

## Fix

Mirror desk-warm (#4558): import `isEtExtendedWarmHours`, add `OFF_WINDOW_FORCE_COOLDOWN_SEC = 300`, compute `effectiveCooldownSec` per request, and use it in the cooldown claim + skip reason. Source-scan regression tests added to each route's `route.test.ts`.

## Verify

- `npx tsx --test src/app/api/cron/heatmap-warm/route.test.ts`
- `npx tsx --test src/app/api/cron/zerodte-warm/route.test.ts`
- `npx tsx --test src/app/api/cron/meridian-warm/route.test.ts`
- Off-hours: repeated `?force=1` against any of the three keys should log rate-limited skips at 300s spacing, not 10s/60s.
