# 2026-09-05 — wallScope + marketFlowCache future-timestamp freshness guards

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Priority** | P2 |
| **Area** | Cache TTL / clock-skew |

## Symptom

`vector-snapshot.ts` wallScope refresh and gamma-wall memo used naive `now - fetchedAt < TTL` comparisons. A future-dated stamp reads as infinitely fresh (same class as #3879 gex-cross-validation / Largo desk cache).

`unusual-whales.ts` `marketFlowCache` used `expiresAt > now` for the hot path and `now - cachedAt <= MAX` for the 429 stale fallback — negative age from clock skew bypasses the stale ceiling.

## Fix

Use shared `isWsUpdatedAtFresh()` at both boundaries (5s future tolerance per `timestamp-freshness.ts`).

## Verify

- `npx tsx --test src/features/vector/lib/vector-snapshot-wallscope-freshness.test.ts`
- `npx tsx --test src/lib/providers/unusual-whales-market-flow-cache-freshness.test.ts`
