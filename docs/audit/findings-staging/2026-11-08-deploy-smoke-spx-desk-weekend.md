## 2026-11-08 — [FINDING, deploy smoke, SPX desk weekend]

> **kind:** `FINDING`

| Field | Detail |
| --- | --- |
| **What broke** | `Deploy smoke` failed on `main` @ `7ee8e8e` with `/api/market/spx/desk → 200` when CI `CRON_SECRET` matched — body had `price: 0` on Sunday off-hours (honest desk shell). Smoke required `price > 0`, so every weekend merge failed deploy CI while the app was healthy. |
| **Fix** | `scripts/lib/spx-desk-smoke-eval.mjs`: pass on `price > 0`; warn on valid desk JSON with `price: 0` when `market_open` is not true; still fail on `market_open: true` + `price≤0`. Wired into `scripts/gha-http-smoke.mjs`. |
| **Status** | FIXED (this PR) |
