> **kind:** `FINDING`

## Cron audit query — off-hours false RED on swing-discovery handshake stale

| | |
|---|---|
| **Status** | FIXED |
| **Area** | `scripts/cron-audit-query.mjs` |
| **Severity** | P2 CI — `main` run `42735522106` failed at 01:25 UTC with `problems: swing-discovery` |

### Root cause

#7862 shipped `evaluateCronWatchdogAudit` for `gha-rth-audit` and `full-site-deep-audit`, but
`cron-audit-query.mjs` still unioned `problem_keys` and `rth_stale_keys` and exited 1 on any
entry — so post-close `swing-discovery` handshake lag red the hourly cron query while RTH deep audit
was already green.

### Fix

Wire HTTP watchdog fallback through `evaluateCronWatchdogAudit` + `inRthOpenWindow()` (same gating
as sibling audits); log ignored off-hours keys; exit 1 only on RTH-stale keys, in-RTH problems, or
critical error spike.

### Verification

`node --test scripts/cron-audit-query.test.mjs scripts/audit/lib/watchdog-audit-eval.test.ts`
