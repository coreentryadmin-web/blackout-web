> **kind:** FINDING

## Deploy smoke `smoke` RED: cron-auth SPX desk 200 with `price: 0` on weekend — FIXED

| | |
|---|---|
| **Area** | `scripts/gha-http-smoke.mjs` |
| **Status** | FIXED — `scripts/audit/lib/http-smoke-spx-desk-verdict.test.ts` |
| **Severity** | P2 (CI false positive; prod route healthy) |

### Root cause

`deploy-smoke.yml` treats CRON-authenticated `GET /api/market/spx/desk` as failed unless `status === 200 && price > 0`. On weekends/off-hours the route correctly returns **200** with an honest shell (`price: 0`, `available: false`) once `CRON_SECRET` matches — CI logged `✗ /api/market/spx/desk → 200` (run `42502809714` on `main`).

### Fix

Extract `spxDeskCronSmokeVerdict()` — pass **ok** when `price > 0`; pass **warn** when cron auth succeeds but the payload is a valid off-hours desk; fail only on 404/5xx/malformed bodies.

### Evidence

`npx tsx --test scripts/audit/lib/http-smoke-spx-desk-verdict.test.ts`
