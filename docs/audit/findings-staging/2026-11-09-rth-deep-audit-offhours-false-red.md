> **kind:** `FINDING`

## RTH deep audit — off-hours false RED on SPX desk price 0 + swing-discovery handshake stale

| | |
|---|---|
| **Status** | FIXED |
| **Area** | `scripts/gha-rth-audit.mjs`, `scripts/full-site-deep-audit.mjs` |
| **Severity** | P2 CI noise — `main` RTH deep audit failed at Mon 18:12 ET with zero cash-RTH defects |

### Root cause

`scripts/gha-http-smoke.mjs` already treats cron-authed `/api/market/spx/desk` returning `price: 0` /
`available:false` as **warn** off-hours via `evaluateSpxDeskSmoke()`. `scripts/full-site-deep-audit.mjs`
still hard-failed `spot missing or invalid: 0` at **P0**, so the child process exited 1 and the
parent labeled “Full-site deep audit” failed even though deploy smoke passed on the same payload.

Separately, `gha-rth-audit.mjs` treated any `cron-staleness-watchdog` `problem_keys` entry (e.g.
`swing-discovery` handshake lag after cash close) as a hard failure even when `rth_stale: 0` — the
watchdog’s higher-priority market-hours staleness signal was already clean.

### Fix

- Reuse `evaluateSpxDeskSmoke` in `auditSpxDesk()`; warn-path records a pass and skips live spot math.
- Gate deep-audit cron STALE on `rth_stale_keys` during off-hours (log off-hours problems, do not P0).
- Skip platform snapshot missing SPX off cash RTH.
- Align `gha-rth-audit` cron-watchdog failure with `rth_stale > 0` when cash RTH is closed.

### Verification

`node --test scripts/full-site-deep-audit.test.mjs scripts/lib/gha-desk-smoke-eval.test.ts`
