# Cron audit query: Monday pre-window false positives (post-close failed + SPX HB)

> **kind:** FINDING

| **Status** | FIXED |

## What broke

Cron audit query run `42649315653` @ Mon ~10:55 AM ET reported:

`problems: spx-evaluate, nighthawk-outcomes, gex-eod-snapshot, banger-discovery`

Three post-close crons were **`failed` from Friday** while `isInOffScheduleIdleGap` was true — stale suppression already honored the gap, but `failed` short-circuited before it.

`spx-evaluate` could read **failed** on the cron handshake while the play-engine heartbeat remained fresh in-window.

## Fix

- Reorder `evaluateJob` so off-schedule idle suppresses prior `failed` like `ok`/`skipped`.
- In `buildCronHealthSnapshot`, trust a fresh play-engine heartbeat over a failed `spx-evaluate` / `spx-issues-sync` handshake during the engine window.

## Verify

`npx tsx --test src/lib/admin-cron-health.test.ts`
