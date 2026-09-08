# Finding: GEX heatmap fetch paths false-fresh on future cache `at`

**Date:** 2026-09-05  
**Severity:** P2  
**Follow-up:** #3833 (peek stale only)

## Symptom

`fetchGexHeatmap` / blocking heatmap serve used `now - entry.at < ttlMs` on L1/L2 cache hits. Future `at` from cross-replica clock skew read as age 0 → served within TTL while peek path (#3833) correctly marked stale.

## Fix

`gexHeatmapCacheEntryWithinTtl()` — same `GEX_WS_FUTURE_TOLERANCE_MS` guard, applied to all four heatmap cache hit sites.
