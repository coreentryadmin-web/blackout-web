# Cron audit query: swing-discovery stale between phase ticks — FIXED

> **kind:** FINDING

| **Status** | FIXED |

## What broke

Cron audit query on `main` @ `1f445e923` (run `42735522106`, Mon ~8:25 PM ET) listed only:

`problems: swing-discovery`

POST_CLOSE had completed (`done` claim) but the next OVERNIGHT phase had not yet logged a handshake — phase-anchored discovery treats that as stale/failed on `cron_job_runs` even though work is on schedule.

## Fix

`swingDiscoveryAwaitingPhaseSuppress()` in `discovery-cron-health.ts`, wired in `buildCronHealthSnapshot`: after primary POST_CLOSE is satisfied for the session, downgrade stale/failed → healthy while inside the next active phase window (unless a scan is in flight or a failure logged in the last 90m).

## Verify

`npx tsx --test src/lib/swing/discovery-cron-health.test.ts`
