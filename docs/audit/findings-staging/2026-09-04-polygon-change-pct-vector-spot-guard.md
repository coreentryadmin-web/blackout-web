# Polygon fabricated 0% change + Vector cold-start wall spot guard — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Priority** | P1 |
| **Area** | Data truth / Vector walls |
| **PR** | (this branch) |

## What was broken

1. **`fetchMarketMovers` / sector snapshots** defaulted missing Polygon `todaysChangePerc` to **0%**, presenting a fabricated flat session when the provider omitted the field and no prior-close rebase was attempted (`polygon.ts` `mapMover`, `fetchStockSnapshotPerformance`).
2. **`getVectorGexWalls`** could emit **wrong-side gamma walls** on cold start: `computeGexWalls` ran with `spot` omitted when `fallbackSpot` was still null (before heatmap scope resolved), the same class PR #2417 fixed on the gex-heatmap route but not the Vector snapshot path.

## Fix

- Shared `changePctFromSnapshotTicker()` — provider field → prior-close rebase → **null** (never 0).
- Movers filter out ungrounded rows; breadth internals use `groundedBreadthSamples()`.
- Vector GEX wall reads return **null walls** until a valid spot is available, then side-constrain.

## Validate at RTH

- Thermal heatmap movers strip: no +0.00% names with missing provider change pre-open.
- Vector board on cold load: walls absent/stale until spot grounds, never call wall below spot on SPX 0DTE.
