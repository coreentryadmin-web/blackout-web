# vector-walls-warm missing off-window force=1 cooldown — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **ID** | BO-P1-0104 |
| **Severity** | P1 |
| **Area** | cron / perf / Vector walls warmer |
| **Status** | FIXED in PR (fix/vector-walls-warm-off-window-cooldown) |

## Symptom

PR #4561 hardened `heatmap-warm`, `zerodte-warm`, and `meridian-warm` with the off-window `?force=1` cooldown pattern from desk-warm (#4558). `vector-walls-warm` shares the identical `force=1` + flat `RERUN_COOLDOWN_KEY` pattern but was omitted from that blast-radius sweep.

## Root cause

`vector-walls-warm` applied a flat 10s in-window cooldown regardless of `isEtExtendedWarmHours()`, so repeated off-hours `?force=1` hammering faced only the tight in-window throttle.

## Fix

Mirror sibling warm crons: import `isEtExtendedWarmHours`, add `OFF_WINDOW_FORCE_COOLDOWN_SEC = 300`, compute `effectiveCooldownSec` per request, use it in the cooldown claim + skip reason. Source-scan regression test added to `route.test.ts`.

## Verify

- `npx tsx --test src/app/api/cron/vector-walls-warm/route.test.ts`
- Off-hours: repeated `?force=1` against `vector-walls-warm:cooldown` should rate-limit at 300s spacing, not 10s.
