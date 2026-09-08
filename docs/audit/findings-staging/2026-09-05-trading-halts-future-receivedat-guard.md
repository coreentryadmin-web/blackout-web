# 2026-09-05 — Trading halts `receivedAt` future-timestamp guard

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Severity** | P2 |
| **Area** | UW/LULD trading halt expiry (`trading-halts-expiry.ts`) |
| **Status** | FIXED |

## Symptom

`isHaltStillActive` used raw `now - halt.receivedAt <= maxAgeMs`. A far-future `receivedAt` (clock skew or bad upstream stamp) reads as negative age and always satisfies `<= maxAgeMs`, pinning an active halt and blocking entries indefinitely.

## Root cause

Incremental future-timestamp migration fixed LULD feed staleness (`luld-halts-store.ts`) and UW channel gates but left the shared `isHaltStillActive` / `pruneExpiredHalts` helper on raw arithmetic.

## Fix

Route `isHaltStillActive` through `isWsUpdatedAtFresh(receivedAt, maxAgeMs + 1, now)` — preserves prior `<=` boundary semantics for non-skewed stamps; rejects stamps beyond `WS_TIMESTAMP_FUTURE_TOLERANCE_MS`.

## Evidence

- `trading-halts-expiry.test.ts` — future beyond tolerance inactive; within tolerance active.
- `trading-halts-expiry-freshness.test.ts` — source-scan guard.

## RTH validation

- SPX/0DTE play gates during a simulated halt: a stale pinned halt should self-clear after `maxAgeMs` even if `receivedAt` was clock-skewed forward.
