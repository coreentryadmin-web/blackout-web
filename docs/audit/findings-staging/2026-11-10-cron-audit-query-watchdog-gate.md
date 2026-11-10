> **kind:** `FINDING`

## Cron audit query false RED — swing-discovery off-hours (2026-11-10)

| **Status** | FIXED |
|------------|-------|

**Symptom:** Run **42735522106** (`1f445e92`) at 01:25 UTC (~20:25 ET): `problems: swing-discovery` via HTTP watchdog fallback.

**Root cause:** `gha-rth-audit` and `full-site-deep-audit` already gate watchdog failures through `evaluateCronWatchdogAudit` (non-`rth_stale` problems off-hours do not fail). `scripts/cron-audit-query.mjs` still exited non-zero on any `problem_keys` entry.

**Fix:** Use the shared evaluator + log off-hours ignored keys.

**Blast radius:** `npm run validate:cron`, scheduled `cron-audit-query.yml`.
