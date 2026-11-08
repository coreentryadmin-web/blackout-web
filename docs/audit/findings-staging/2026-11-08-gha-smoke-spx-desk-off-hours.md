# Deploy smoke false-fail: SPX desk 200 without RTH spot

> **kind:** FINDING

## Symptom

GitHub **Deploy smoke** on `main` @ `7ee8e8e9` failed: `/api/market/spx/desk → 200` with cron auth but `body.price` not `> 0` (Sunday off-hours cold desk).

## Root cause

`scripts/gha-http-smoke.mjs` treated any authenticated `200` without `price > 0` as failure. Off-hours/weekends the desk may return an honest empty or stale shell while the route and auth layer are healthy.

## Fix

Extracted `evaluateSpxDeskCronSmoke()` — pass on `price > 0`, `available: false`, or valid desk JSON off cash RTH; still fail `available: true` + `price: 0` during cash RTH.

| **Status** | FIXED |
