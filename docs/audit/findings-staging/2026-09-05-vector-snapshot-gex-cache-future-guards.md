# 2026-09-05 — Vector snapshot VEX/flip/dark-pool + GEX cache reader future-timestamp guards

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Severity** | P2 |
| **Area** | Vector SSE stream, GEX heatmap cache readers |
| **Status** | FIXED |

## Symptom

Sibling caches in `vector-snapshot.ts` (VEX walls, gamma flip, dark-pool refresh triggers, wall-history recordability) still used raw `Date.now() - at` comparisons after the gamma-wall memo was migrated to `isWsUpdatedAtFresh`. A future `at` stamp reads as infinitely fresh and can skip background refresh or record stale walls into durable rails.

`readGexHeatmapCacheOnly` and `pickStaleHeatmapForHandoff` in `polygon-options-gex.ts` had the same shape — future `entry.at` served as valid cache or won handoff preference.

## Root cause

Incremental migration of future-timestamp guards (2026-09-03..05) fixed gamma walls and wallScope but missed VEX walls, flip, dark-pool, recordability gates, and the strict cache-only reader path used by 0DTE thesis evidence.

## Fix

- `vector-snapshot.ts` — route VEX walls, flip memo, stream refresh triggers, and wall-history recordability through `isWsUpdatedAtFresh`.
- `polygon-options-gex.ts` — `readGexHeatmapCacheOnly` uses `gexHeatmapCacheEntryStale`; `pickStaleHeatmapForHandoff` uses `gexHeatmapCacheEntryWithinTtl` and skips far-future entries from the `any` fallback.

## Evidence

- `vector-snapshot-wallscope-freshness.test.ts` — extended source-scan guards.
- `polygon-options-gex.test.ts` — source-scan for cache-only + handoff paths.

## RTH validation

- Vector stream (`/vector` or SPX desk embed): VEX lens + gamma-flip line should refresh on cadence after a deploy; no indefinitely-stale wall chips after simulated cache skew.
- Admin GEX health panel: `age_sec` for heatmap entries should not read negative on cross-replica reads.
