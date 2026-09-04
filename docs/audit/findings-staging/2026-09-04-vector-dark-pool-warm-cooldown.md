# vector-dark-pool-warm missing force=1 cooldown — FIXED

> **kind:** `FINDING`

| Field | Value |
|---|---|
| **Status** | FIXED |
| **Found by** | Cursor autopilot continuous work loop, 2026-09-04 |
| **Priority** | P3 Performance |

## What was broken

`vector-dark-pool-warm` accepted `?force=1` (bypasses cash-RTH gate via `cron-dispatch.ts`) with no
minimum re-run floor. The route returns HTTP 202 as soon as it dispatches a ~55-ticker UW REST fan-out
in `after()` — so repeated `force=1` replays could stack against the shared 2 RPS UW budget with nothing
capping frequency. Same structural gap fixed on desk-warm (#3540), heatmap-warm (#3542), and
vector-walls-warm (#3747).

## Fix

Added `RERUN_COOLDOWN_KEY = "vector-dark-pool-warm:cooldown"` with `RERUN_COOLDOWN_SEC = 60` (matches
other UW-heavy warmers; well below the ~10 min EventBridge schedule).

## Tests

`src/app/api/cron/vector-dark-pool-warm/route.test.ts` — source ordering + behavioral `sharedCacheSetNx` TTL test.

## RTH validation

- Admin force-run `GET /api/cron/vector-dark-pool-warm?force=1` twice within 60s — second response should
  `skipped: true` with `rate-limited` reason; first should return 202 accepted.
