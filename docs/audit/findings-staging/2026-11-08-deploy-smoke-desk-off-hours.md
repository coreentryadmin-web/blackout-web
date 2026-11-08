# Deploy smoke false-red: SPX desk 200 without live price off-hours

> **kind:** FINDING

| **Status** | FIXED (PR pending) |
|------------|-------------------|

## Symptom

`Deploy smoke` on `main` @ `7ee8e8e` (2026-11-08): `✗ /api/market/spx/desk → 200`.

## Root cause

`gha-http-smoke.mjs` required `body.price > 0` on any cron-authenticated 200. Off-hours/weekends the desk can honestly return `market_open: false` with `price: 0` while the route and auth are healthy.

## Fix

`spxDeskCronDeploySmokeVerdict`: pass 200 when `price > 0`, or `market_open === false`, or `available === false`; still fail RTH `market_open: true` with `price: 0`.

## Verify

`npx tsx --test scripts/gha-http-smoke.test.mjs`
