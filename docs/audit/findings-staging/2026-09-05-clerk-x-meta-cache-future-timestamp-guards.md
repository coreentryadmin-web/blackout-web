# Clerk / X-marketing cache future-timestamp guards — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **ID** | BO-P2-2026-09-05-clerk-x-meta-cache-freshness |
| **Priority** | P2 |
| **Status** | FIXED |
| **Area** | Freshness guards |

## Symptom

`getClerkUserCached` dedupe and `getCachedFollowingUserIds` used raw `Date.now() - at` TTL checks. A far-future `at` stamp yields negative age that never expires the entry — same class fixed in #3912 across session/tier/play caches.

## Root cause

In-process Clerk dedupe (5s) and X marketing following-ID cache (1h) lacked the shared future-tolerance guard (`WS_TIMESTAMP_FUTURE_TOLERANCE_MS`).

## Fix

Route both through `isWsUpdatedAtFresh(at, maxAgeMs)` from `@/lib/ws/timestamp-freshness`.

## Evidence

- `src/lib/clerk-user-cache-freshness.test.ts`
- `src/lib/x-marketing-meta-freshness.test.ts`
