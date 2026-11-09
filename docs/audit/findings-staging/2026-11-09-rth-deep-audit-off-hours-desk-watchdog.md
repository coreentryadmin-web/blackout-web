> **kind:** FINDING

| **Status** | FIXED |

## What broke

RTH deep audit run **42718407755** (Mon 18:12 ET, off `inRthOpenWindow`): full-site P0
`spx-desk spot 0` and `cron-watchdog: swing-discovery`.

## Fix

- `spxDeskSpotAuditVerdict` — P0 live spot only during cash RTH; off-hours accept prior_close or honest `available:false`.
- `gha-rth-audit` — warn-only watchdog for `swing-discovery` when outside 09:00–16:15 ET window.

## Verify

`node --test scripts/audit/lib/spx-desk-audit-eval.test.mjs`; next scheduled 10:00/14:00/16:30 ET audit.
