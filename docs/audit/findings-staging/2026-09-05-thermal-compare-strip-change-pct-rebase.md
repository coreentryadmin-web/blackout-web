> **kind:** FINDING

## ThermalCompareStrip used raw matrix `change_pct` without live-push rebase — FIXED

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Severity** | P2 |
| **Area** | Thermal `/heatmap` compare strip |

## Root cause

`ThermalCompareStrip.tsx` read `data?.change_pct` directly from the gex-heatmap poll while live push spot could diverge from the matrix snapshot. `ThermalTripleDesk` and `GexHeatmap` already rebase via `rebaseChangePct` (#3944); the compare strip did not, so SPY/SPX/QQQ cards could show a % change inconsistent with the main desk header on fast moves.

## Fix

Wire `useLiveQuoteStream` once for `THERMAL_COMPARE_TICKERS`, pass push spot into each `CompareCard`, and derive displayed `chg` with the same `rebaseChangePct(pushSpot, { price: matrixSpot, change_pct: matrixChangePct })` fallback chain as `ThermalTripleDesk`.

## Evidence

- Cross-exam CLQ-018 (`.blackout-agent/CURSOR_ANSWERS_FOR_CLAUDE.md`)
- Regression: `src/features/thermal/components/ThermalCompareStrip-header-change-pct.test.ts`

## Market-open validation

On `/heatmap` during RTH: compare strip % on SPY/SPX/QQQ should match the triple-desk column header for the same ticker when live push is connected (no rising spot + falling % mismatch).
