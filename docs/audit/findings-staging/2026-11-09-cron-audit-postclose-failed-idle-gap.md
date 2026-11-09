# Cron audit query: Friday failed post-close jobs failed CI all Monday morning — FIXED

> **kind:** FINDING

| **Status** | FIXED |

## What broke

Cron audit query on `main` @ `1cc122c0` (run `42649315653`, Mon ~10:55 AM ET) listed:

`problems: spx-evaluate, nighthawk-outcomes, gex-eod-snapshot, banger-discovery`

Three post-close crons (`30/10/15 20,21 * * 1-5`) were **`failed`** from Friday Polygon 403s while `isInOffScheduleIdleGap` was **true** — ops #1983 suppressed **stale** in that gap but `evaluateJob` still short-circuited on `last.status === "failed"` before off-schedule suppression.

## Fix

- In `evaluateJob`, treat `failed` like ok/skipped inside off-schedule idle gaps (and dual-band await).
- In `buildCronHealthSnapshot`, when `spx-evaluate`/`spx-issues-sync` last handshake failed but play-engine heartbeat is fresh in-window, prefer heartbeat (same family as stale-handshake override).

## Verify

`npx tsx --test src/lib/admin-cron-health.test.ts` — new Mon-morning post-close case GREEN.

## Market open

After Mon ~4:10 PM ET, if post-close crons still `failed` with 403, production `POLYGON_API_KEY` still needs Secrets Manager attention (see MARKET-OPEN-VALIDATION 2026-11-07 incident).
