# Vector GEX king role mislabeled as "pin" + daily chart fabricated flat 0% — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **ID** | BO-P2-vector-king-node-label-daily-readout |
| **Status** | FIXED |
| **Area** | Vector |
| **Severity** | P2 |

## What was broken

1. **Pin vs king-node confusion:** Vector contract-pick role `gex-king-pin` displayed "GEX king pin" / "Thermal GEX king pin" to members. That conflates the dealer **GEX king node** (largest |γ| strike) with an EOD **pin** forecast — SPX Pin already uses distinct `gex_king` vs `pin` labels (`spx-metric-labels.ts`).

2. **Fabricated flat 0%:** `VectorDailyChart` hover readout computed `(close−open)/open` and fell back to **`0%`** when `open` was missing/zero, which reads as "unchanged" rather than "unknown".

## Fix

- Renamed member-facing copy to **"GEX king node"** / **"Thermal GEX king node"** in `VectorContractPicksCard`, `vector-pick-evidence`, `vector-play-candidates`, and the Vector learn guide.
- Daily chart hover: `changePct` is `null` when `open <= 0`; readout shows **"—"** instead of `0.00%`.

## Evidence

- `npx tsx --test src/features/vector/lib/vector-pick-evidence.test.ts`
- `npx tsx --test src/features/vector/components/vector-chart-viewport.test.ts`
