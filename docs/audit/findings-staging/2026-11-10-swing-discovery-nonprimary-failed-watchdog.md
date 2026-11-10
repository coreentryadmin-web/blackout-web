# Cron audit query: OVERNIGHT swing-discovery failed while POST_CLOSE snapshot OK — FIXED

> **kind:** FINDING

| **Status** | FIXED |

## What broke

`Cron audit query` on `main` (run **42735522106**, Mon ~20:24 ET) failed with `problems: swing-discovery` while earlier 16:24 ET run was GREEN.

## Root cause

Phase-anchored discovery logs a `failed` `cron_job_runs` row for secondary phases (e.g. `OVERNIGHT`) even when the **POST_CLOSE** serving snapshot is the member-facing contract and already satisfied for the session. Watchdog treats any `failed` as P0 with no primary-phase carve-out.

## Fix

- `swingDiscoveryPostCloseSnapshotSatisfied()` — today's snapshot at/after POST_CLOSE start, intraday age ceiling.
- `buildCronHealthSnapshot`: downgrade non-`POST_CLOSE` `failed` handshakes to `warning` when that helper passes (`POST_CLOSE` failures still page).

## Verify

`npx tsx --test src/lib/swing/discovery-cron-health.test.ts`
