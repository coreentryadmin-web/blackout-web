## 2026-09-03 — [FINDING, P2 infra/harness, SPX Slayer] `validate:spx-e2e` falsely FAILed on mid-deploy Next.js chunk 404s during post-close orchestrator burst — FIXED

> **kind:** `FINDING`

| Field | Detail |
|---|---|
| **What prompted this** | SPX Slayer post-close fix agent (`validate:spx-rth -- --phase=post-close`) reported `spx:dashboard-e2e` FAIL while standalone `npm run validate:spx-e2e` intermittently passed. Report JSON showed `ui:console-errors` FAIL with `ChunkLoadError: Loading chunk … failed` and `404` on `/_next/static/chunks/*.js` — classic ECS rolling-deploy HTML/chunk skew, not a SPX product defect. |
| **Root cause** | `scripts/spx-dashboard-e2e-audit.mjs` treated only origin `5xx` console noise as transient; chunk `404` + MIME-type errors during `ecr-push-production.yml` rollouts were counted as hard FAILs. The parent orchestrator also held an audit-fetch Clerk session through the E2E spawn, increasing FAPI pressure (secondary; primary failure was chunk skew). |
| **Fix** | Classify deploy chunk skew (`ChunkLoadError`, `404` on `_next/static/chunks`, MIME-type refusal) as transient console noise (same policy as `member-dashboard-live-check.mjs`). One automatic dashboard reload after a 5s wait when the first load only produced chunk noise. Release audit Clerk session before spawning `validate:spx-e2e` in `spx-rth-all-day-audit.mjs`. |
| **Blast radius** | Harness only — no member-facing SPX logic changed. |
| **Regression guard** | Post-fix `npm run validate:spx-rth -- --phase=post-close` and `npm run validate:spx-e2e` both GREEN on prod. |
