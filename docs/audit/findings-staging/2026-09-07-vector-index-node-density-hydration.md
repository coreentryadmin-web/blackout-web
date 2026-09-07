# Vector index tickers never hydrate NODES preference (or the AUTO ladder) — stuck at 20 rows/side

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Priority** | P2 |
| **Area** | Vector chart / bead rail NODES control |

## Symptom

Every Vector desk open shows `NODES: 20 ROWS` regardless of ticker or timeframe, even on a fresh
session with no saved preference. On SPX at 3m the correct AUTO count is 11
(`wallCountForTimeframe(3) = max(VECTOR_0DTE_WALL_COUNT=10, 11) = 11`), not 20.

## Root cause

`VectorChart.tsx`'s NODES-hydration effect only loads the member's saved density pick (or lets it
resolve to `"auto"`) when the desk-open default is exactly the `"auto"` sentinel:

```
if (defaultNodeDensity !== VECTOR_DEFAULT_NODE_DENSITY) return;
```

`defaultVectorNodeDensity()` (`vector-ticker.ts`) was changed (2026-08-19, `6dd0accd9`) to always
return a fixed `20` for every ticker, to fix a real NVDA/single-name density complaint ("AUTO was
self-limiting NVDA to ~7"). That silently disabled the hydration guard above for EVERY ticker,
including SPX — the desk-open default is never `"auto"` anymore, so the effect always returns
early. A member's saved NODES preference, and the timeframe-driven AUTO ladder (8/11/13/16), never
load for any ticker.

## Fix

`defaultVectorNodeDensity()` is now ticker-aware: index tickers (SPX, NDX, RUT, DJI, VIX) default
to `"auto"` (restoring hydration + the correct AUTO ladder); single names keep the fixed `20`
(unaffected — the 2026-08-19 NVDA fix is preserved).

## Verify

```
npx tsx --test src/features/vector/lib/vector-ticker.test.ts
```

## Note on scope

Live A/B tested on production (manually switching NODES 20→AUTO via the existing dropdown) —
confirmed this does NOT materially change the dominant bead-row density/thickness a member
reported seeing (separate, still-open investigation: the current paint/draw code and the recorded
wall-history data are both confirmed unchanged/dense — root cause not yet found). This fix is
shipped on its own merits (a genuine hydration bug, confirmed via code + test), not as a fix for
that separate visual complaint.
