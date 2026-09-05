> **kind:** `FINDING`

## 2026-09-05 — [P2, data-correctness] `ThermalCompareStrip` raw `change_pct` not rebased on live push — FIXED

| **Status** | FIXED in PR (this branch) |
|---|---|
| **Severity** | P2 — compare-strip % change disagreed with main Thermal desk after session rebase |
| **Root cause** | `ThermalCompareStrip.tsx` used `data?.change_pct` directly while sibling surfaces (`GexHeatmap`, `ThermalTripleDesk`) rebase via `rebaseChangePct` when live push spot diverges from matrix snapshot |
| **Fix** | Wire `useLiveQuoteStream` + `rebaseChangePct` in `CompareCard`, mirroring `ThermalTripleDesk` column headers |
| **Evidence** | `ThermalCompareStrip-header-change-pct.test.ts` (source-scan regression); cross-exam CLQ-018 |
