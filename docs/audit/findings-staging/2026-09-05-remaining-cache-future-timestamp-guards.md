# Remaining cache future-timestamp guards — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **ID** | BO-P2-2026-09-05-remaining-cache-freshness |
| **Priority** | P2 |
| **Status** | FIXED |
| **Area** | Freshness guards |

## Symptom

Follow-on scan after #3912 found three more in-process/DB cache layers using raw `Date.now() - at` TTL checks: `clerk-user-cache`, `bie/stage5-proposals`, `x-marketing-meta` following set.

## Fix

Route all three through `isWsUpdatedAtFresh(at, maxAgeMs)`, including the `MAX_RESOLVED` eviction sweep in `clerk-user-cache` (same gap as #3917).

## Evidence

- `src/lib/cache-future-timestamp-guards.test.ts`
