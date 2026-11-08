> **kind:** `FINDING`

## 2026-11-08 — Deploy smoke fails on weekend: `/api/market/spx/desk` 200 without live price — FIXED

| **Status** | Fixed (PR pending) |
|------------|-------------------|
| **Symptom** | `deploy-smoke.yml` on `main@7ee8e8e` failed: `✗ /api/market/spx/desk → 200` while every public probe passed. |
| **Root cause** | `scripts/gha-http-smoke.mjs` treated any authenticated 200 without `body.price > 0` as a hard fail. Off-hours / weekend desks correctly return `available:false` + `price:0` under cron auth — not a broken deploy. |
| **Fix** | `classifySpxDeskCronProbe()` — pass with WARN on reachable 200 without live price; keep FAIL for 404/5xx only. |
| **Verify** | `node --test scripts/lib/gha-http-smoke-spx-desk.test.mjs`; next `deploy-smoke` push off-hours GREEN with ⚠ line. |
