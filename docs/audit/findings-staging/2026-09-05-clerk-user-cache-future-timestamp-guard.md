# Clerk user-cache future-timestamp guard — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **ID** | BO-P2-2026-09-05-clerk-user-cache-freshness |
| **Priority** | P2 |
| **Status** | FIXED |
| **Area** | Freshness guards |

## Symptom

`getClerkUserCached` dedupe used raw `Date.now() - hit.at < DEDUPE_TTL_MS`. A far-future `at` stamp never expires — same class fixed in #3912 for session/tier/play caches.

## Fix

Route hit lookup and eviction sweep through `isWsUpdatedAtFresh(at, DEDUPE_TTL_MS)`.

## Evidence

- `src/lib/clerk-user-cache-freshness.test.ts`
