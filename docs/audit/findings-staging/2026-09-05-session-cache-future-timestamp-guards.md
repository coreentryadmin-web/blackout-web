# Session / Claude / tier cache future-timestamp guards — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **ID** | BO-P2-2026-09-05-session-cache-freshness |
| **Priority** | P2 |
| **Status** | FIXED |
| **Area** | Freshness guards |

## Symptom

`readSessionCache`, `spx-play-claude` `readCache`, and `tier-cache` used raw `Date.now() - at` TTL checks. A far-future `at` stamp yields negative age that never expires the entry — same class of bug fixed across WS/flow paths via `isWsUpdatedAtFresh`.

## Root cause

Client `sessionStorage` envelopes and in-process tier/play caches lacked the shared future-tolerance guard (`WS_TIMESTAMP_FUTURE_TOLERANCE_MS`).

## Fix

Route all three through `isWsUpdatedAtFresh(at, maxAgeMs)` from `@/lib/ws/timestamp-freshness`.

## Evidence

- `src/lib/session-cache-freshness.test.ts`
- `src/features/spx/lib/spx-play-claude-freshness.test.ts`
- `src/lib/tier-cache-freshness.test.ts`
