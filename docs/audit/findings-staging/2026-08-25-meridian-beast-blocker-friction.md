## 2026-08-25 — [FINDING, P2 Meridian] Beast-blocker friction bundle — FIXED

> **kind:** `FINDING`

| Field | Detail |
|---|---|
| **Symptom** | Six polish/integration gaps blocked power use: (1) cold timeline load ~8–10s with blank analytics lane, (2) macro detail all-shimmer with no brief on slow fetch, (3) beat-streak copy contradicted track record (already fixed on main via `printHistoryToAnalyticsRows`), (4) analytics grid stacked above an orphaned timeline rail, (5) Largo `get_earnings_history` / `get_earnings_market` used UW close-to-close reactions instead of Meridian's BMO/AMC engine, (6) Largo could not reach Meridian's sector-peer cohort (`get_meridian_peer_cohort` missing — Positioning tab computed client-side only). |
| **Root cause** | Monolithic timeline payload waited on Polygon expected-move batch + sector classify before first paint; macro panel gated all content on `loading`; analytics view stacked grids above the split-pane lane; Largo earnings tools bypassed `loadMeridianEarningsPrintHistory` / `stockReactionsForPrints`; peer cohort lived only in `MeridianPeerCohortPanel`'s client-side timeline filter with no server tool. |
| **Fix** | Lite timeline (`skip_enrich=1`) + dual SWR in `MeridianDesk`; labeled loading skeletons; analytics view shows catalyst strip and hides split pane; progressive macro card shimmers + honest unavailable brief; Largo tools route history through Meridian print_history and attach `meridian_reaction_pct` to session lists; new `get_meridian_peer_cohort` reuses `buildCohortForTimelineItem` + `loadMeridianPeerReactions`. |
| **Status** | FIXED — `meridian-timeline-lite.test.ts`, `meridian-earnings-for-largo-core.test.ts`, `meridian-peer-cohort-for-largo-core.test.ts`, existing beat-streak regression on main. |
