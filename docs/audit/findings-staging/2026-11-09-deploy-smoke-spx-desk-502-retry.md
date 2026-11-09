# Deploy smoke RED — transient 502 on authenticated SPX desk post-deploy

> **kind:** `FINDING`

| **Status** | FIXED (PR pending) |
|------------|-------------------|

### Symptom

`deploy-smoke` on `main@0dee31c5` failed with `✗ /api/market/spx/desk → unexpected HTTP 502` after `/api/ready` and public probes passed.

### Root cause

The smoke probe used a single `fetch` to `/api/market/spx/desk`. During ECS rollouts a draining replica can return 502 while cold desk builds warm elsewhere — not a broken deploy.

### Fix

Use shared `fetchRetry` (4 attempts, 2s backoff) for the cron-authenticated desk probe in `scripts/gha-http-smoke.mjs`, matching `validate-deploy` / watchdog discipline.

### Verify

Green `deploy-smoke` on the next merge; `npx tsx --test scripts/lib/gha-desk-smoke-eval.test.ts` unchanged.
