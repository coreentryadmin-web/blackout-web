> **kind:** FINDING

## RTH deep audit failed on swing-discovery P1 + transient GEX cold — FIXED

| **Status** | FIXED |
|---|---|
| **What broke** | `main` @ `0ba38002` RTH deep audit ~15:38 ET: `cron-watchdog` failed on `swing-discovery` (P1-only per ops-collect); `data-integrity` / full-site P0 on `getGexPositioning` null while heatmap audit passed (Polygon circuit-open blip). |
| **Fix** | `evaluateCronWatchdogAudit` fails only on `rth_stale_keys` + critical `error_spike` (matches ops-collect P0). `readGexPositioningResilient` retries GEX cache reads before C6 cold flags. |
