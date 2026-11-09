# RTH deep audit off-hours false P0 (desk spot + swing-discovery watchdog)

> **kind:** FINDING

| **Status** | FIXED |
|---|---|
| **Symptom** | `RTH deep audit` run **42718407755** (`ebb16827`) at Mon 6:12 PM ET: P0 `[spx-desk] SPOT: 0` + `cron-watchdog: swing-discovery` |
| **Root cause** | Workflow runs off-hours; full-site audit still required live desk spot and treated all watchdog `problem_keys` as failures. Post-close cron staleness (e.g. swing-discovery) is expected off-window. |
| **Fix** | Gate desk/snapshot/heatmap live checks on `inRthOpenWindow()`; cron sections only elevate `rth_stale_keys` off-hours. |
| **Verify** | `node --test scripts/full-site-deep-audit.test.mjs`; next scheduled RTH deep audit. |
