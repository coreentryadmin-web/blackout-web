> **kind:** `FINDING`

| Field | Value |
| --- | --- |
| **Status** | FIXED |

## RTH deep audit false P0 at post-close (6:12 PM ET)

### What broke

Run **42718407755** (`main@ebb16827`): P0 `spx-desk` spot 0, empty heatmaps, `cron-watchdog` swing-discovery — at **Mon 18:12 ET** (after `inRthOpenWindow` closes at 16:15). Scheduled 4:30 PM slot still runs off RTH.

### Fix

- `spxDeskSpotAuditVerdict`: off-hours pass when `prior_close` grounded
- Heatmap/snapshot/public indices lenient off-hours
- `gha-rth-audit`: cron-watchdog off-hours only blocks on `rth_stale_keys`

### Evidence

`node --test scripts/audit/lib/deep-audit-spx-spot-eval.test.mjs scripts/full-site-deep-audit.test.mjs`
