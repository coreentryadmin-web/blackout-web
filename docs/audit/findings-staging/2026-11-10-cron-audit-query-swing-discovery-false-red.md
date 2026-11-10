> **kind:** FINDING

## cron-audit-query false RED on off-hours swing-discovery — FIXED

| **Status** | Fixed in `fix/cron-audit-query-p0-scope` |
| --- | --- |

**Symptom:** `query` check failed on `main` @ `1f445e92` (#7870) — `problems: swing-discovery` only, off-hours.

**Root cause:** `cron-audit-query.mjs` HTTP fallback exited non-zero on any `problem_keys` entry. `gha-rth-audit` / `full-site-deep-audit` already use `evaluateCronWatchdogAudit`; cron audit did not.

**Fix:** Wire the same `evaluateCronWatchdogAudit` + `inRthOpenWindow()` verdict before `process.exit`.

**Verify:** `npx tsx --test scripts/audit/lib/watchdog-audit-eval.test.ts scripts/cron-audit-query.watchdog.test.mjs`
