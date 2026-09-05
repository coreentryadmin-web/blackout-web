# 2026-09-05 — 0DTE live marks SSE quiet gate future-at guard

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **ID** | BO-P2-zerodte-live-marks-sse-future |
| **Priority** | P2 |
| **Area** | Night Hawk / 0DTE live marks |
| **Status** | FIXED (pending merge) |
| **PR** | fix/zerodte-live-marks-sse-future-guard |

## Symptom

`useZeroDteLiveMarks` poll fallback used `Date.now() - lastSseAtRef.current < SSE_QUIET_MS`. A clock-skewed future `lastSseAtRef` yields negative age → poll suppressed indefinitely while SSE is dead → stale marks presented as live on the Night Hawk board.

## Root cause

Raw subtraction freshness gate without `isWsUpdatedAtFresh` future-timestamp guard (Class-2 pattern scan 2026-09-05).

## Fix

Route the SSE quiet gate through `isWsUpdatedAtFresh(lastSseAtRef.current, SSE_QUIET_MS)` so far-future stamps fail closed and REST fallback wakes.

## Evidence

- Source scan regression: `src/features/nighthawk/hooks/useZeroDteLiveMarks-freshness.test.ts` (RED pre-fix via `assert.doesNotMatch` on raw subtraction)

## Blast radius

Night Hawk 0DTE board live mark transport only — no server/API change.
