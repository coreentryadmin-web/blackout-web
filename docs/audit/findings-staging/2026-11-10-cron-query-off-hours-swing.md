> **kind:** FINDING

| Field | Value |
| --- | --- |
| **Title** | Cron audit query RED off-hours on swing-discovery (non-RTH stale) |
| **Status** | FIXED |

## What broke

`cron-audit-query` run **42735522106** (Mon 2026-11-10 01:25 UTC / 8:25 PM ET off cash RTH): watchdog `problem_keys: swing-discovery` with empty `rth_stale_keys`.

## Fix

HTTP fallback gates exit failures on `rth_stale_keys` outside `inRthOpenWindow()`; full `problem_keys` still logged as informational. Shared `cron-watchdog-query-eval.mjs` (matches `gha-rth-audit` discipline).

## Verify

`npx tsx --test scripts/lib/cron-watchdog-query-eval.test.ts`
