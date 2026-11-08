# Deploy smoke RED — SPX desk `price:0` off-hours with valid prior_close

> **kind:** `FINDING`

| **Status** | FIXED (PR pending) |
|------------|-------------------|

### Symptom

`deploy-smoke` failed on `main@7ee8e8e` with `✗ /api/market/spx/desk → 200` while CRON auth succeeded.

### Root cause

`scripts/gha-http-smoke.mjs` required `body.price > 0` on an authenticated 200. Off-hours desk payloads often freeze `price` at 0 while still serving a grounded `prior_close` (Sunday / post-close tape).

### Fix

Treat cron-authenticated 200 as pass when `price > 0` **or** `prior_close > 0` (and no `error` field).

### Verify

`node scripts/gha-http-smoke.mjs` with `CRON_SECRET` on a weekend; deploy-smoke workflow green after merge.
