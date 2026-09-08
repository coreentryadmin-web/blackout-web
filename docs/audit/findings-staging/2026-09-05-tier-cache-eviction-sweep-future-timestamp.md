# Tier-cache eviction sweep future-timestamp guard — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **ID** | BO-P2-2026-09-05-tier-cache-eviction-sweep-freshness |
| **Priority** | P2 |
| **Status** | FIXED |
| **Area** | Freshness guards |

## Symptom

#3912 fixed tier-cache read paths but `setTierCache`'s `MAX_TIER_CACHE` eviction sweep still used `now - v.at >= TIER_CACHE_TTL_MS` — same gap as #3920 in clerk-user-cache.

## Fix

Route eviction sweep through `isWsUpdatedAtFresh(v.at, TIER_CACHE_TTL_MS, now)`.

## Evidence

- `src/lib/tier-cache-freshness.test.ts`
