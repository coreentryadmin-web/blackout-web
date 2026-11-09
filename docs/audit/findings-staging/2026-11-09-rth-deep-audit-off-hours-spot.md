> **kind:** FINDING

## RTH deep audit RED off-hours (desk spot 0 + swing-discovery watchdog) — FIXED

| **Status** | FIXED |
|---|---|
| **What broke** | Run `42718407755` @ `ebb16827` (18:12 ET): P0 `spx-desk` spot 0 after cash close; `cron-watchdog` failed on `swing-discovery` though Postgres section already skips off-hours. |
| **Fix** | `full-site-deep-audit.mjs` off-hours spot uses `isApproxUsCashRth` (warn/ok, not P0). `gha-rth-audit.mjs` cron-watchdog only fails off-hours on `error_spike=critical`. |
