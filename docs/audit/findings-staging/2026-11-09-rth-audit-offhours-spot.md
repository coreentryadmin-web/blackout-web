> **kind:** `FINDING`

## RTH deep audit false RED off-hours (2026-11-09)

| **Status** | FIXED |
|------------|-------|

**Symptom:** Run **42718407755** at `ebb16827` (Mon 18:12 ET, market closed): P0 `[spx-desk] SPOT: spot missing or invalid: 0` and `cron-watchdog: swing-discovery`.

**Root cause:** Full-site audit always P0'd `price === 0` even when desk returned honest `available:false` after the bell; GHA RTH audit failed any cron-watchdog `problem_keys` off-hours even though Postgres RTH checks are already skipped when cash RTH is closed.

**Fix:** `spxDeskSpotAuditVerdict` (prior_close grounding + off-hours empty skip); cron-watchdog step warns-only when `!inRthOpenWindow()` and no `rth_stale_keys`.

**Blast radius:** `gha-rth-audit.mjs`, `full-site-deep-audit.mjs`.
