# Remaining cache future-timestamp guards — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **ID** | BO-P2-2026-09-05-remaining-cache-freshness |
| **Priority** | P2 |
| **Status** | FIXED |
| **Area** | Freshness guards |

## Symptom

After #3915 merged clerk-user hit + x-marketing following guards, two paths still used raw `Date.now() - at` TTL checks: `clerk-user-cache` eviction sweep (`setResolved` at `MAX_RESOLVED`) and `bie/stage5-proposals` scan cache.

## Fix

Route both through `isWsUpdatedAtFresh(at, maxAgeMs)` from `@/lib/ws/timestamp-freshness`.

## Evidence

- `src/lib/remaining-cache-future-timestamp-guards.test.ts`
