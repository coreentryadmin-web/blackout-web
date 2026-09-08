# Finding: GEX peek stale + thermal cross-check future freshness gaps

**Date:** 2026-09-05  
**Severity:** P2  
**Area:** `polygon-options-gex.ts` admin peek + `thermal-desk-state.ts` cross-check layer

## Symptom

1. `peekGexHeatmapCache()` used raw `ageMs > gexHeatmapMaxStaleMs()` — future `entry.at` → negative age → always `stale: false` while `age_sec` displayed 0.
2. `thermalLayerFreshness()` hardcoded cross-check `status: "live"` whenever `crossValUwAsof` parsed — no age/future guard unlike matrix/overlays.

## Fix

- `gexHeatmapCacheEntryStale()` — align with `GEX_WS_FUTURE_TOLERANCE_MS` + clamped age
- Cross-check routes through `statusFromAge(age, OVERLAY_LIVE_MS, OVERLAY_STALE_MS)`

## Tests

- `thermal-desk-state.test.ts` — cross-check future → syncing, aged → stale
- `polygon-options-gex.test.ts` — `gexHeatmapCacheEntryStale` regression
