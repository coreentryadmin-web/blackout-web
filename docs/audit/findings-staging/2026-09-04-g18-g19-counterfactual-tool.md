## 2026-09-04 — [TOOLING, P1 0DTE] G-18/G-19 counterfactual report script — BO-P1-0004 deliverable

| Field | Detail |
|---|---|
| **What** | `npm run counterfactual:0dte-g18-g19` — runs skip-grading backfill + calibration API, surfaces `early_window_prime_score` (G-18) and `score_top_band` (G-19) blocked-value lines with KEEP/HOLD/REVIEW verdicts, plus optional session replay. |
| **Why** | BO-P1-0004 required measuring whether G-18/G-19 loss gates (#3425) are saving money post-deploy. Replay tool was blocked until #3441 fixed POLYGON_API_BASE placeholder. |
| **Prereqs** | Prod Clerk admin session (same as `gate-calibration-live-report.mjs`). |
| **Status** | SHIPPED (script + tests) — live prod run pending credentials in RTH window |
