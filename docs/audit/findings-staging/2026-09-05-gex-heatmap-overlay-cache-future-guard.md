> **kind:** FINDING

# GEX heatmap overlay/NH/explain + UW spot-fallback caches shared quote-route clock-skew bug — FIXED

| **Status** | FIXED |
|------------|-------|
| **Pri** | P2 |
| **Area** | `gex-heatmap/route.ts`, `gex-heatmap/explain/route.ts`, `spot-fallback.ts` |

## Symptom

`now - entry.at < ttlMs` on in-memory/Redis cache-hit gates treats a future `entry.at` (cross-replica
clock skew) as negative age, which always satisfies `< ttlMs` and serves stale-but-"fresh" overlay,
Night Hawk context, explain narrative, or UW spot-fallback data indefinitely — same class as #3823
(quote REST cache) and #3834/#3839 (polygon-options-gex caches).

## Fix

Route all 6 cache-hit gates through the shared `isWsUpdatedAtFresh(at, ttlMs, now)` helper from
`@/lib/ws/timestamp-freshness` (5s future tolerance, same as quote route's `isQuoteCacheAtFresh`).

## Evidence

- Source-scan regression tests: `cache-freshness-guards.test.ts`, `spot-fallback-freshness.test.ts`
- RED confirmed against pre-fix raw comparisons; GREEN post-fix

## Blast radius

Read-only cache admission on GEX heatmap enrichment paths and UW spot fallback — forces recompute
instead of serving untrustably future-dated entries; no change to fetch/build logic.
