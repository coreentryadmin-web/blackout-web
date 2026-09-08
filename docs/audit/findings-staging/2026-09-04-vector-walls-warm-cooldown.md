# vector-walls-warm missing force=1 cooldown — FIXED

> **kind:** `FINDING`

| Field | Value |
|---|---|
| **Status** | FIXED |
| **Found by** | Cursor autopilot continuous work loop, 2026-09-04 |
| **Priority** | P3 Performance |

## What was broken

`vector-walls-warm` had `OVERLAP_LOCK` (cross-replica in-flight guard) but no `RERUN_COOLDOWN`.
`?force=1` bypasses the cash-RTH gate entirely; once a warm pass completes (often fast on a hot
walls cache), nothing capped how often `force=1` could be replayed — the same structural gap
fixed on desk-warm (#3540), heatmap-warm (#3542), meridian-warm, and zerodte-warm.

## Evidence

- Route accepts `force=1` to bypass `isEtCashRth()` off-hours skip.
- `rth-warm-leader` heal threshold for this key is 20s (`RTH_WRITER_HEAL_AFTER_MIN`).
- `OVERLAP_LOCK` releases in `finally` as soon as the background warm settles.

## Fix

Added `RERUN_COOLDOWN_KEY = "vector-walls-warm:cooldown"` with `RERUN_COOLDOWN_SEC = 10`
( safely below the 20s leader heal threshold, mirroring heatmap-warm's proportion).

## Tests

`src/app/api/cron/vector-walls-warm/route.test.ts` — source-text ordering assertions +
behavioral `sharedCacheSetNx` TTL test.
