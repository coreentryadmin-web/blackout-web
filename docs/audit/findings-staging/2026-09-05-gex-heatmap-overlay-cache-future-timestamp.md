# GEX heatmap overlay/explain cache future-timestamp guard

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **ID** | BO-P1-0108 |
| **Status** | FIXED |
| **Severity** | P1 |
| **Area** | `GET /api/market/gex-heatmap` overlay enrichment + explain narrative cache |

## Symptom

Overlay (`gex-overlay:{ticker}`) and explain (`gex-explain:{ticker}`) caches used `now - at < TTL` without a future-timestamp guard. Cross-replica clock skew could stamp `at` ahead of the reader's clock → negative age always passes TTL → stale UW overlay/narrative served as fresh on Thermal/Vector.

Same failure class as #3823 (quote REST cache) and #3820 (SPX desk).

## Fix

- Wire `isWsUpdatedAtFresh(at, ttlMs, now)` from `timestamp-freshness.ts` on L1 mem + L2 Redis hits in `route.ts` (`getOverlays`, `getNightHawkContext`) and `explain/route.ts` (explain cache + overlay reuse).

## Tests

- `src/app/api/market/gex-heatmap/route-guards.test.ts` — source scan for helper + call sites.

## Market-open validation

- Open `/heatmap` on SPY during RTH; toggle overlay-enriched tickers; confirm flow/dark-pool overlay chips track live when a replica's Redis writer clock skews (compare `overlay_at` age vs wall clock in network panel).
