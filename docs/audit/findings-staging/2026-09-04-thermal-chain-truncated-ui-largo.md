## 2026-09-04 — [FINDING, P3 UX/trust, Thermal/SPX/Largo] `chain_truncated` was computed server-side but invisible to members and Largo — FIXED

> **kind:** `FINDING`

| Field | Detail |
|---|---|
| **What prompted this** | Autopilot queue cleared after BO-P1-0004/#3463; resumed independent work from `thermal-followup-pr-3-chain-truncation.md` (PARTIALLY SHIPPED — server field live since 2026-09-03, UI/Largo still absent). |
| **Root cause** | `buildGexHeatmapUncached` already sets `chain_truncated: true` when Polygon pagination hits the page guard (`polygon-options-gex.ts:3772`), and the public snapshot carries it — but neither `GexHeatmap.tsx`, `SpxGexMatrixHeatmap.tsx`, nor `gexHeatmapForLargo` projected or displayed it. Members and Largo had no signal that walls/OI might understate. |
| **Fix** | (1) Thermal matrix + SPX Slayer rail: amber honesty badge when `data.chain_truncated` is true (same placement/style as the existing UW divergence note). (2) `GexHeatmapForLargo` carries `chain_truncated?: boolean` from `hm.chain_truncated`. |
| **Regression guard** | `src/lib/largo/chain-truncated-projection.test.ts` — source asserts type field + `hm.chain_truncated` wiring + empty-branch null. |
| **Status** | FIXED |
