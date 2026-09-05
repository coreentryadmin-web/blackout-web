> **kind:** `FINDING`

## 2026-09-05 — [P2, data-correctness] Legacy Night Hawk push quotes use raw WS change_pct — FIXED

> **kind:** `FINDING` | **Found by:** Cursor autopilot hourly sweep | **Status:** FIXED

| | |
|---|---|
| **Severity** | P2 — member-visible day % on Legacy board can disagree with REST anchor after push spot moves |
| **Root cause** | `use-legacy-quotes.ts` applied push `changePct` from `useLiveQuoteStream` without `rebaseChangePct`, while REST polls already served rebased `/api/market/quote` values. Sibling desks (ThermalTripleDesk, ThermalCompareStrip, GexHeatmap) rebase push spot against the REST snapshot. |
| **Fix** | Store `restAnchor` from each REST poll; on push ticks use `rebaseChangePct(pushPrice, restAnchor) ?? pushChangePct`. Source-scan regression test added. |
| **Evidence** | `use-legacy-quotes-change-pct.test.ts`; pattern match to #3962 Thermal CompareStrip fix. |
