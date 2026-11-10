> **kind:** FINDING

| Field | Value |
| --- | --- |
| **Title** | Cron audit query failed off-hours on swing-discovery only |
| **Status** | FIXED |

## What broke

`cron-audit-query` run **42735522106** (Mon 2026-11-09 ~8:25 PM ET): `problems: swing-discovery` with `rth_stale` empty. `gha-rth-audit` / `full-site-deep-audit` already use `evaluateCronWatchdogAudit`; the scheduled query script still unioned all `problem_keys` and exited 1.

## Fix

HTTP watchdog fallback in `scripts/cron-audit-query.mjs` → `evaluateCronWatchdogAudit` + `inRthOpenWindow()` (same RTH vs post-close contract).

## Verify

`npx tsx --test scripts/cron-audit-query.test.mjs scripts/audit/lib/watchdog-audit-eval.test.ts`
