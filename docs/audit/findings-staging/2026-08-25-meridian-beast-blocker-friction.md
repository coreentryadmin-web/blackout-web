## 2026-08-25 — [FINDING, P2 Meridian] Beast-blocker friction bundle — FIXED

> **kind:** `FINDING`

| Field | Detail |
|---|---|
| **Symptom** | Five polish gaps blocked power use: (1) cold timeline load ~8–10s with blank analytics lane, (2) macro detail all-shimmer with no brief on slow fetch, (3) beat-streak copy contradicted track record (already fixed on main via `printHistoryToAnalyticsRows`), (4) analytics grid stacked above an orphaned timeline rail, (5) Largo `get_earnings_history` / `get_earnings_market` used UW close-to-close reactions instead of Meridian's BMO/AMC engine. |
| **Root cause** | Monolithic timeline payload waited on Polygon expected-move batch + sector classify before first paint; macro panel gated all content on `loading`; analytics view stacked grids above the split-pane lane; Largo earnings tools bypassed `loadMeridianEarningsPrintHistory` / `stockReactionsForPrints`. |
| **Fix** | Lite timeline (`skip_enrich=1`) + dual SWR in `MeridianDesk`; labeled loading skeletons; analytics view shows catalyst strip and hides split pane; progressive macro card shimmers + honest unavailable brief; Largo tools route history through Meridian print_history and attach `meridian_reaction_pct` to session lists. |
| **Status** | FIXED — `meridian-timeline-lite.test.ts`, `meridian-earnings-for-largo.test.ts`, existing beat-streak regression on main. |
