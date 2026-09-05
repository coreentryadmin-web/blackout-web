# Tier-cache eviction sweep future-timestamp guard — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **ID** | BO-P2-2026-09-05-tier-cache-eviction-sweep-freshness |
| **Priority** | P2 |
| **Status** | FIXED |
| **Area** | Freshness guards |

## Symptom

`resolveUserTier`'s read path already uses `isWsUpdatedAtFresh(cached.at, TIER_CACHE_TTL_MS)` but
`setTierCache`'s size-pressure eviction sweep still used raw arithmetic:
`if (now - v.at >= TIER_CACHE_TTL_MS) tierCache.delete(k)`. A far-future/clock-skewed `v.at` yields a
negative age that never satisfies `>= TIER_CACHE_TTL_MS`, so the sweep never evicts that entry — it
only leaves the map via the `MAX_TIER_CACHE` oldest-key fallback. Same bug class as #3920
(clerk-user-cache eviction sweep), different file.

## Fix

Route the eviction sweep through the same shared `isWsUpdatedAtFresh(v.at, TIER_CACHE_TTL_MS, now)`
helper already used on the read path.

## Evidence

- `src/lib/tier-cache-freshness.test.ts` — extended with a second assertion; RED (1/2 fail) on the
  unfixed source, GREEN (2/2 pass) after the fix.
- `npx tsx --test src/lib/tier-cache-freshness.test.ts` clean.

## Blast radius

`tier-cache.ts` only, and only the `MAX_TIER_CACHE` (5,000-entry) size-pressure sweep path — no
behavior change for normal-path lookups (already guarded on read).
