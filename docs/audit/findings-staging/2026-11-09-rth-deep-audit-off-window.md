> **kind:** FINDING

## RTH deep audit false RED after cash close (6 PM ET run)

| **Status** | FIXED (this PR) |
|------------|-----------------|
| **Detected** | `rth-deep-audit.yml` run `42718407755` on `main` @ `ebb16827` (~18:12 ET) |
| **Symptom** | P0 SPX spot 0, heatmap empty, cron-watchdog `swing-discovery` — off-hours |
| **Root cause** | Full-site deep audit + cron-watchdog hard-fail ran outside cash RTH while Postgres correctly skipped |
| **Fix** | `inRthDeepAuditWindow()` (9:00–16:45 ET); skip deep audit off-window; lenient cron-watchdog unless `rth_stale_keys` |
| **Verify** | `node --test scripts/gha-et-window.test.mjs` |
