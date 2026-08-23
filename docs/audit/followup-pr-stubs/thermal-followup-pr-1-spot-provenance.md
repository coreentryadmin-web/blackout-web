# PR: Add Spot Provenance Field to GEX Heatmap

**Issue:** Five fallback paths produce spot; payload doesn't record which. No counter/log for fallback frequency.

**Root cause:** `resolveSpotSnapshot()` tries five sources in order (WS → Redis → Polygon REST → prev session → synthetic 0), but heatmap consumer doesn't know which succeeded. This matters for debugging (WS live vs cached vs fallback) and for transparency (member knows data freshness path).

**Files to change:**
1. `src/lib/public-gex-snapshot.ts` — add `spot_source` field to `GexHeatmap`
2. `src/lib/providers/polygon-options-gex.ts` — pass source from `resolveSpotSnapshot` to `buildGexHeatmapUncached`
3. `src/lib/largo/contract/product-read.ts` — document `spot_source` in Largo contract
4. `src/lib/route-registry.ts` — document field in `/api/market/gex-positioning` description

**Implementation:**

```typescript
// In polygon-options-gex.ts buildGexHeatmapUncached signature:
export async function buildGexHeatmapUncached(
  ticker: string,
  {
    spot,
    spotSource = 'unknown', // NEW: source of spot value
    expiries,
    ...
  }
) {
  return {
    spot,
    spot_source: spotSource, // NEW: wire through to payload
    ...existing fields
  }
}

// In resolveSpotSnapshot, return tuple instead of scalar:
export async function resolveSpotSnapshot(...): Promise<[number, string]> {
  // Try WS first
  const wsSpot = await liveWsIndexSpot(ticker).catch(() => null);
  if (wsSpot !== null) return [wsSpot, 'ws'];
  
  // Try Redis cache
  const redisSpot = await fetchClusterRedisIndexSpot(ticker).catch(() => null);
  if (redisSpot !== null) return [redisSpot, 'redis_cluster'];
  
  // Try Polygon REST
  const polySpot = await fetchPolygonRestSpot(ticker).catch(() => null);
  if (polySpot !== null) return [polySpot, 'rest'];
  
  // Try prev session
  const prevSpot = await fetchPrevSessionSpot(ticker).catch(() => null);
  if (prevSpot !== null) return [prevSpot, 'prev_bar'];
  
  // Synthetic (emergency only)
  return [syntheticSpot, 'synthetic'];
}

// In buildGexHeatmapUncached:
const [spot, spotSource] = await resolveSpotSnapshot(ticker);
```

**Tests:**
- Unit: `polygon-options-gex.test.ts` — verify `spot_source` is passed through in all code paths
- Integration: `data-validator.mjs` — log `spot_source` distribution across 100+ ticker requests
- Live: Tomorrow RTH — check if `spot_source` distribution skews WS (expected) or REST (fallback indicating WS issue)

**Evidence:** No change to spot value itself, only metadata. Backward compatible (new field, existing fields unchanged). Breaking change only if a consumer requires the field; no consumer currently consumes it.

**Risk:** Low. Field is additive, doesn't affect existing calculations.
