## 2026-08-25 — [FINDING, P2 Meridian] Quarterly Beat/Miss Streak read the forward calendar window instead of print_history — FIXED

> **kind:** `FINDING`

| Field | Detail |
|---|---|
| **Symptom** | Live, DKS earnings (2026-08-25, real print), History tab: "Quarterly Beat/Miss Streak" card read *"No printed quarters on record for DKS"* directly beneath "Earnings Track Record — 7/8 EPS beats" and "Beat Rates — 88%/88%/88% over 8 graded prints" for the exact same ticker, same screen. Found during a CTO-depth Meridian audit (`docs/audit/MERIDIAN-CTO-AUDIT-2026-08-25.md`). |
| **Root cause** | `MeridianEarningsHistoryPanel.tsx` fed `buildBeatMissStreak` (`meridian-earnings-analytics-core.ts`) from an `analyticsRows` prop tracing back to `data.earnings_analytics_rows` — built by `buildEarningsAnalyticsRows` from Benzinga's forward-looking earnings-calendar window (days-ahead, market-wide). That is a who's-reporting-when calendar, not a history of past prints, so `hasPrinted(row)` (`actual_eps != null`) essentially never matched. The neighboring panels correctly read `enrichment.print_history` — the real per-ticker historical print array. |
| **Fix** | New `printHistoryToAnalyticsRows(ticker, prints)` adapter reshapes `print_history` into the `EarningsAnalyticsRow` shape `buildBeatMissStreak` expects. `MeridianEarningsHistoryPanel` now computes streak rows from `enrichment.print_history` (already in hand, already rendered correctly by the neighboring panels) instead of the mis-sourced prop. |
| **Status** | FIXED — `printHistoryToAnalyticsRows` + wiring change, `meridian-earnings-analytics-core.test.ts` regression coverage. `npx tsc --noEmit` clean, targeted suite green. |
