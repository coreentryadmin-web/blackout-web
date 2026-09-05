> **kind:** FINDING

# gex-heatmap overlay/explain route caches shared #3834's clock-skew false-fresh bug — FIXED

| **Status** | FIXED |
|------------|-------|
| **Pri** | P2 |
| **Area** | `src/app/api/market/gex-heatmap/route.ts`, `explain/route.ts` — overlay, NH context, explain narrative caches |

## Symptom

#3834/#3839 fixed the raw `now - entry.at < ttlMs` false-fresh bug in `polygon-options-gex.ts`.
The sibling Thermal route caches (overlay enrichment Redis + in-memory, Night Hawk context,
explain narrative Redis + in-memory) still used the identical vulnerable comparison. A
clock-skewed future `at` from a cross-replica Redis write reads as negative age, passes the
TTL check, and serves stale overlay/narrative data indefinitely.

## Root cause

Same as #3834: unguarded `now - cached.at < ttlMs` on Redis-backed cache hits where `at` is
written by another ECS replica.

## Fix

Route all 6 cache-hit gates through the already-shipped `gexHeatmapCacheEntryWithinTtl()`.

## Evidence

- Source-scan tests in `cache-ttl-future-guard.test.ts` (RED pre-fix via git stash, GREEN post-fix).
- `npx tsx --test src/app/api/market/gex-heatmap/cache-ttl-future-guard.test.ts`

## Blast radius

Thermal `/heatmap` overlay enrichment + explain narrative only. Core matrix fetch path already
fixed in polygon-options-gex.
