> **kind:** FINDING

## RTH deep audit false RED off-hours — FIXED

| **Status** | Fixed in `fix/rth-deep-audit-off-hours-false-red` |
| --- | --- |

**Symptom:** `RTH deep audit` failed on `main` @ `ebb16827` (docs-only merge) at Mon 18:12 ET with `audit` check red.

**Root cause:** The workflow’s 16:30 ET slot is intentionally **after** `inRthOpenWindow()` (ends 16:15). Two harness mismatches:
1. `full-site-deep-audit.mjs` P0-failed missing SPX desk spot (`0`) off-hours.
2. `gha-rth-audit.mjs` failed the whole run on any `cron-staleness-watchdog` `problem_keys` entry (e.g. `swing-discovery`), while `ops-collect` treats those as P1 unless `rth_stale_keys` or critical `error_spike`.

**Fix:** Off-hours desk spot → pass with `spot-off-hours`; cron-watchdog GHA step uses `cronWatchdogGhaVerdict` aligned with ops P0/P1 split.

**Verify:** `npx tsx --test scripts/lib/gha-cron-watchdog-eval.test.mjs` + `npx tsx --test scripts/full-site-deep-audit.test.mjs`.
