# Finding: 0DTE board shared snapshot false-fresh on future `as_of`

**Date:** 2026-09-05  
**Severity:** P1  
**Area:** `zerodte-service` board convergence / member serve path

## Symptom

`readSharedBoardSnapshot()` used `Math.max(0, Date.now() - asOfMs)` for `ageMs`. A clock-skewed future `as_of` produced age `0`, passing `BOARD_SNAPSHOT_SERVE_MAX_AGE_MS` and serving a stale snapshot as current.

`localBoardIsServable()` used `nowMs - asOfMs <= maxAgeMs` — future timestamps always passed.

## Fix

- `zeroDteSnapshotAgeMs()` in `marks-math.ts` — future beyond `ZERODTE_MARK_FUTURE_TOLERANCE_MS` → `+Infinity`
- `readSharedBoardSnapshot()` uses `zeroDteSnapshotAgeMs`
- `localBoardIsServable()` delegates to `isZeroDteMarkStale(asOfMs, nowMs, maxAgeMs)`

## Tests

- `marks-math.test.ts` — `zeroDteSnapshotAgeMs` + board serve regression
