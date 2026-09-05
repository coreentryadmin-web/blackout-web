# Tier-cache eviction sweep future-timestamp guard — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Priority** | P2 |
| **Status** | FIXED |
| **Area** | Freshness guards |

## Symptom

#3912 fixed `resolveUserTier` read path (`isWsUpdatedAtFresh(cached.at, TIER_CACHE_TTL_MS)`) but left
`setTierCache`'s size-pressure eviction sweep on raw `now - v.at >= TIER_CACHE_TTL_MS`. A far-future
`v.at` never satisfies `>= TTL`, so corrupted entries are not swept until LRU fallback — same bug
class as #3920 (clerk-user-cache eviction).

## Fix

Route eviction sweep through `isWsUpdatedAtFresh(v.at, TIER_CACHE_TTL_MS, now)`.

## Evidence

- `src/lib/tier-cache-freshness.test.ts` — extended eviction-sweep assertion
