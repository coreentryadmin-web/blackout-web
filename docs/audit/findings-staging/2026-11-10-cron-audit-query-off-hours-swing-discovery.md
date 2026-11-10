> **kind:** FINDING

## Cron audit query false RED off-hours (swing-discovery post-close) — FIXED

| **Status** | Fixed in PR |
| --- | --- |

**Symptom:** `query` workflow on `main` `1f445e923` failed Monday ~8:25 PM ET: `problems: swing-discovery` via HTTP watchdog fallback.

**Root cause:** `scripts/cron-audit-query.mjs` merged `problem_keys` + `rth_stale_keys` unconditionally. #7862 aligned `full-site-deep-audit` and `gha-rth-audit` with `evaluateCronWatchdogAudit()` but left the scheduled query job on the old logic.

**Fix:** Wire `evaluateCronWatchdogAudit` + `inRthOpenWindow()` in the watchdog fallback path.
