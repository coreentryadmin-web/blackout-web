## 2026-11-08 — Deploy smoke red on honest unavailable SPX desk — FIXED

> **kind:** `FINDING`

| Field | Detail |
| --- | --- |
| **Symptom** | `Deploy smoke` failed on every `main` push 2026-11-08 with `✗ /api/market/spx/desk → 200` despite healthy `/api/health` and `/api/ready`. |
| **Root cause** | `scripts/gha-http-smoke.mjs` treated any cron-authenticated `200` without `price > 0` as a deploy failure. Prod returned an honest fail-closed desk during Massive `/v3/snapshot` entitlement loss (`available:false`, `price:0`, `source:"none"`) — route and ECS deploy healthy, upstream spot absent. |
| **Fix** | `evaluateSpxDeskSmokeProbe()` — pass on grounded `price` or `prior_close`; WARN on cron drift or honest `available:false` with `as_of`; FAIL only on 5xx/404 or `available:true` with zero spot. |
| **Status** | Fixed — `scripts/audit/lib/gha-spx-desk-smoke-eval.mjs` + smoke runner wired. |
