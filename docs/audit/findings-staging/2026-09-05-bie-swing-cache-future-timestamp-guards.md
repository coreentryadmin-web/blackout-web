# BIE stage5 + swing ex-div cache future-timestamp guards — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **ID** | BO-P2-2026-09-05-bie-swing-cache-freshness |
| **Priority** | P2 |
| **Status** | FIXED |
| **Area** | Freshness guards |

## Symptom

`findStage5Proposals` (1h filesystem scan cache) and `resolveSwingExDividendContext` (6h ex-div cache) used raw `Date.now() - at` TTL checks. A far-future `at` stamp yields negative age that never expires the entry — same class fixed in #3912/#3915.

## Root cause

Two remaining in-process caches lacked the shared future-tolerance guard (`WS_TIMESTAMP_FUTURE_TOLERANCE_MS`).

## Fix

Route both through `isWsUpdatedAtFresh(at, maxAgeMs)` from `@/lib/ws/timestamp-freshness`.

## Evidence

- `src/lib/bie/stage5-proposals-freshness.test.ts`
- `src/lib/swing/ex-dividend-reads-freshness.test.ts`
