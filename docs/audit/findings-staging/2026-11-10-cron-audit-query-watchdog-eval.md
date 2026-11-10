> **kind:** FINDING

## Cron audit query failed off-hours on swing-discovery only — FIXED

| **Status** | FIXED |
|---|---|
| **What broke** | `main` @ `1f445e92` query CI: `problems: swing-discovery` at ~20:25 ET while RTH closed — `cron-audit-query.mjs` still treated any `problem_keys` as hard fail, unlike `gha-rth-audit` / `evaluateCronWatchdogAudit`. |
| **Fix** | HTTP watchdog fallback uses `evaluateCronWatchdogAudit` + `inRthOpenWindow` (fail on `rth_stale_keys` / critical spike / in-RTH non-RTH problems only). |
