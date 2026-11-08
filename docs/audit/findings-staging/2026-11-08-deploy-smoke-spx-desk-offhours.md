> **kind:** `FINDING`

## Deploy smoke false RED — `/api/market/spx/desk` off-hours (2026-11-08)

| **Status** | FIXED (smoke harness) |
|------------|----------------------|

**Symptom:** `deploy-smoke` run `42502809714` on commit `7ee8e8e` failed with `✗ /api/market/spx/desk → 200` — authenticated cron probe returned HTTP 200 but `body.price` was not `> 0`.

**Root cause:** `scripts/gha-http-smoke.mjs` treated only `price > 0` as a healthy desk. Off-hours and weekend desks often ground spot on `prior_close` while `price` is `0` or lags on the first post-deploy cache warm.

**Fix:** `evaluateSpxDeskCronProbe` in `scripts/audit/lib/gha-http-smoke-desk-eval.mjs` — pass on `price > 0` (RTH) or `prior_close > 0` (off-hours); single optional retry after deploy warm. Unit tests in `gha-http-smoke-desk-eval.test.ts`.

**Blast radius:** `deploy-smoke`, `rth-preopen-smoke`, `rth-post-close-smoke`, `gha-rth-audit` (same script).
