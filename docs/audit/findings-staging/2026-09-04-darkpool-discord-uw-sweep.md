# darkpool-discord missing runWithBackgroundUwSweep — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **ID** | BO-P2-darkpool-discord-uw-sweep |
| **Priority** | P2 |
| **Area** | cron / UW rate limiter |
| **Status** | FIXED |

## Symptom

`darkpool-discord` cron called `fetchUwDarkPoolRecent` up to three times per tick (live scan, 15m digest, EOD recap) without the shared `runWithBackgroundUwSweep` tag used by every other UW-heavy cron.

## Root cause

The route was added before the background-sweep convention was enforced across UW REST crons. `scanDarkpoolDiscordFromCache` is cache-first but falls through to `uwGetSafe("/api/darkpool/recent")` on miss.

## Fix

Wrapped the tick body in `runWithBackgroundUwSweep(() => runDarkpoolDiscordTick(...))` and added `route.test.ts` source-scan regression guards matching `flow-ingest`.

## Blast radius

`src/app/api/cron/darkpool-discord/route.ts` only. No behavior change except UW concurrency slot reservation for member traffic.

## Evidence

- `npx tsx --test src/app/api/cron/darkpool-discord/route.test.ts` GREEN
- Hourly checklist pattern scan (2026-09-04)
