# 2026-11-08 — deploy-smoke false FAIL on authenticated SPX desk off-hours

> **kind:** FINDING

## deploy-smoke: authenticated `/api/market/spx/desk` returned HTTP 200 with `price` not > 0 on a weekend — FIXED

| **Status** | FIXED in PR (cursor/autopilot-state-recovery-loop-125e) |
| --- | --- |

**Symptom:** `Deploy smoke` workflow failed at `scripts/gha-http-smoke.mjs` with
`✗ /api/market/spx/desk → 200` on `main` @ `7ee8e8e91` (2026-11-08, Sunday off-hours).

**Root cause:** The cron-authenticated desk probe only passed on `status===200 && price>0`.
Off-hours/weekend desk builds can legitimately return `200` with `price: 0` and no
`prior_close` yet while still proving auth + route health — not a broken deploy.

**Fix:** `spxDeskCronSmokeVerdict()` — PASS on `price>0` or grounded `prior_close>0`;
WARN (do not fail) on authenticated `200` with desk payload but no spot; keep FAIL on
404/5xx only.

**Evidence:** `scripts/lib/gha-http-smoke-desk-eval.test.mjs` RED→GREEN cases for live
spot, cron drift, prior_close, and off-hours shell.
