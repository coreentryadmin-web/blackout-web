# Deploy smoke false RED on post-rollout SPX desk cold cache — FIXED

> **kind:** FINDING

| **Status** | FIXED (PR pending) |

## What broke

**Deploy smoke** on `main` @ `7ee8e8e91` (run `42502809714`) failed after a healthy ECS rollout:
HTTP smoke reported `✗ /api/market/spx/desk → 200` — cron auth succeeded but `price` was not yet
grounded (`body.price > 0` check), a transient cold-replica / post-deploy desk build window.

## Root cause

`scripts/gha-http-smoke.mjs` probed `/api/market/spx/desk` exactly once. Right after deploy the route
can return HTTP 200 with `price: 0` until `loadSpxDesk()` finishes (same class as the 2026-11-01
peek-shell guard), which is not a broken deploy.

## Fix

Add bounded retries (default 6 × 5s) plus pure `spxDeskSmokePass()` in
`scripts/audit/lib/gha-http-smoke-eval.mjs` so only missing spot after the warm window fails CI.

## Verify

`node --test scripts/audit/lib/gha-http-smoke-eval.test.mjs` GREEN.
