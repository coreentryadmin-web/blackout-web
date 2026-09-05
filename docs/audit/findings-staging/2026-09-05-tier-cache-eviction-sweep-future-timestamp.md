# Tier-cache eviction sweep future-timestamp guard — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **ID** | BO-P2-2026-09-05-tier-cache-eviction-sweep-freshness |
| **Priority** | P2 |
| **Status** | FIXED |
| **Area** | Freshness guards |

## Symptom

#3912 fixed the read path (`isWsUpdatedAtFresh(cached.at, TIER_CACHE_TTL_MS)`) but left
`setTierCache`'s size-pressure eviction sweep on raw `now - v.at >= TIER_CACHE_TTL_MS`. A
far-future/clock-skewed `v.at` never satisfies `>= TTL`, so the sweep never evicts that entry —
same bug class as #3920 (clerk-user-cache eviction sweep).

## Fix

Route the eviction sweep through `!isWsUpdatedAtFresh(v.at, TIER_CACHE_TTL_MS, now)`.

## Evidence

- `src/lib/tier-cache-freshness.test.ts` — second assertion; RED (1/2 fail) pre-fix, GREEN post-fix.
