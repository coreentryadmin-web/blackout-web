# RTH deep audit false RED off-hours (desk spot + swing-discovery watchdog) — FIXED

> **kind:** FINDING

| **Status** | FIXED |

## What broke

`RTH deep audit` run `42718407755` on `ebb16827f` at **Mon ~6:12 PM ET** (outside `inRthOpenWindow`):

- **Full-site deep audit** P0: `[spx-desk] spot missing or invalid: 0` while cron desk returned `available:false` (honest closed-market empty desk).
- **cron-watchdog**: `swing-discovery` in `problem_keys` — phase-anchored post-close job; not an in-RTH market-hours stale.

Postgres RTH checks already skipped off-hours; HTTP deep audit did not.

## Fix

- `evaluateFullSiteSpxDeskSpot` — skip P0 when `available:false` or off RTH (mirrors deploy-smoke discipline).
- `gha-rth-audit.mjs` — off-hours, fail cron-watchdog only on `rth_stale_keys`, not generic `problem_keys`.

## Verify

`node --test scripts/lib/full-site-spx-desk-eval.test.mjs`
