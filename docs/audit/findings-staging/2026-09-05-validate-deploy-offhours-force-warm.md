## validate-deploy: post-deploy `desk-warm?force=1` ran every session off-hours — contributor to weekend tail-latency storm

> **kind:** `FINDING`

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Severity** | P2 (perf/tail-latency — not member-facing outage) |

### What was broken

`scripts/validate-deploy.mjs` always called `/api/cron/desk-warm?force=1` (and staging warmers)
after every deploy check. `force=1` bypasses `isEtExtendedWarmHours`, so every Cloud Agent session
running `npm run validate:deploy` on a Saturday (or any off-hours window) triggered a ~30s median
background warm — one of the 54 distinct IPs identified in the desk-warm weekend force storm
(finding `2026-09-05-desk-warm-weekend-force-storm.md`).

### Fix

Skip the force-warm block entirely when `!isEtExtendedWarmHours()` (weekday 4:00 AM–8:00 PM ET).
Logs `cache warm skipped — outside extended warm window` and continues GREEN.

### Evidence

`npm run validate:deploy` on 2026-09-05 (Saturday): section 2b prints skip message, no
`desk-warm` HTTP call, overall GREEN.

### RTH watch

Monday deploy validation during extended warm hours should still run desk-warm and log `desk-warm → ok`.
