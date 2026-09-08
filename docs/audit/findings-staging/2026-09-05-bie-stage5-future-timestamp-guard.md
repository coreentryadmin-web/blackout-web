# BIE stage5-proposals future-timestamp guard — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Priority** | P2 |
| **Status** | FIXED |
| **Area** | Freshness guards |

## Symptom

`findStage5Proposals()` 1h filesystem scan cache used raw `Date.now() - cache.at < CACHE_TTL_MS`. A far-future `at` stamp yields negative age → cache never expires.

## Fix

Route TTL check through `isWsUpdatedAtFresh(cache.at, CACHE_TTL_MS)` (same guard class as #3912/#3915).

## Evidence

- `src/lib/bie/stage5-proposals-freshness.test.ts`
