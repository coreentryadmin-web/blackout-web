# Market movers fabricated flat 0% when Polygon omits change — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Priority** | P1 |
| **Area** | polygon.ts / market movers |
| **PR** | (pending) |

## Symptom

`fetchMarketMovers()` coerced missing `todaysChangePerc` to `0` via `?? 0`, presenting unknown movers as "unchanged on the day" on `/api/market/heatmap`, Largo `get_market_movers`, Night Hawk discovery, and BIE breadth.

## Root cause

```ts
change_pct: Number((t.todaysChangePerc ?? 0).toFixed(2))
```

## Fix

Return `change_pct: null` when `todaysChangePerc` is absent or non-finite; sort treats null as 0 magnitude; Night Hawk movers lane skips null change.

## Evidence

- Regression: `src/lib/providers/polygon-market-movers.test.ts`
- Pattern aligned with `GexHeatmap-header-change-pct.test.ts` and `change-pct.ts` null-honesty contract
