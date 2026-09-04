# 2026-09-04 — SPX pulse stream local freshness future guard

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Severity** | P2 |
| **Area** | `/api/market/spx/pulse/stream` shared snapshot refresher |
| **Status** | FIXED |

## Symptom

`refreshSnapshot()` preferred local `indexStore` when `Date.now() - fresh < 10_000` with no future-timestamp guard — a clock-skewed future `updatedAt` reads as infinitely fresh and skips the cross-replica Redis fallback.

## Fix

Route local freshness through `isWsUpdatedAtFresh(fresh, 10_000)`.

## Evidence

- `src/app/api/market/spx/pulse/stream/route.test.ts` source scan.

## RTH validation

- SPX pulse rail shows live spot during RTH; no stale local indexStore stuck when Redis has fresher cross-replica snapshot.
