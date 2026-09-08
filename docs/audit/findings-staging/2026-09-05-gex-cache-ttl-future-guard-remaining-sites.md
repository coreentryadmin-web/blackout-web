> **kind:** FINDING

# 4 more polygon-options-gex caches shared #3834's clock-skew false-fresh bug — FIXED

| **Status** | FIXED |
|------------|-------|
| **Pri** | P2 |
| **Area** | `src/lib/providers/polygon-options-gex.ts` — 0DTE desk bundle, positioning bundle, IV term structure, realized vol caches |

## Symptom

#3834 fixed the shared GEX heatmap fetch cache's `now - entry.at < ttlMs` false-fresh bug (a
clock-skewed future `entry.at` reads as negative age, satisfies the TTL check trivially, and
serves stale-but-"fresh" cached data indefinitely). While independently reviewing that PR, a grep
for the same raw comparison shape across the rest of the file found it was not exhaustive — 4
more in-memory/Redis cache-hit gates in the same file had the identical vulnerability, untouched
by #3834 because it only looked at "heatmap"-named cache sites:

- `fetchPolygonOdteDeskBundle` — in-memory `cachedOdteBundle` check AND its Redis fallback (2
  sites in one function)
- `fetchPolygonPositioningBundle` — in-memory `positioningCache` check
- `fetchPolygonIvTermStructure` — in-memory `ivTermCache` check
- `fetchPolygonRealizedVol` — in-memory `realizedVolCache` check

## Root cause

Same as #3834: `now - cached.at < someTtlMs` treats a future `cached.at` (cross-replica clock
skew) as a very negative age, which is always `< ttlMs`, so the check passes and the stale entry
is served as if freshly built — for as long as the skew persists, since nothing ever forces a
rebuild.

## Fix

Route all 5 sites through #3834's already-shipped, already-tested
`gexHeatmapCacheEntryWithinTtl(entryAtMs, nowMs, ttlMs)` — it's fully generic (no heatmap-specific
logic), so no new helper was needed. Updated its doc comment to reflect the broader reuse.

## Evidence

- New test in `polygon-options-gex.test.ts`: a source-scan (same convention already used in this
  file for `fetchPolygonIvTermStructure`'s `HEATMAP_PAGE_GUARD` regression test — these functions
  do live network fetches against module-scoped cache Maps, impractical to unit-test behaviorally
  without heavy mocking) asserting each of the 4 functions calls `gexHeatmapCacheEntryWithinTtl`
  and none contains the raw `now - X.at < Y` pattern anymore. RED (fails on the exact pre-fix
  source) confirmed via `git stash`, GREEN post-fix.
- Full `polygon-options-gex.test.ts`: 63/63 pass (Node 20 + `--experimental-test-module-mocks`).
- Full `npm test`: 12537/12537 pass, 0 fail. `npx tsc --noEmit`: clean.

## Blast radius

0DTE GEX desk bundle (SPX/SPXW walls), GEX positioning bundle, IV term structure, and realized
volatility — all read-only cache admission logic, same class of fix as #3834 (forces a rebuild
instead of serving an untrustably future-dated entry; no change to fetch/build logic itself).
