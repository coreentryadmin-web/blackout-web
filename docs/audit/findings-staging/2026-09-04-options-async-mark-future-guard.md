# Options async live-mark future-timestamp guard — FIXED

> **kind:** FINDING

## Summary

`getLiveOptionMark()` (async, Redis-cross-instance path) gated freshness with raw `Date.now() - ts <= maxAgeMs`. A clock-skewed future `ts` yields negative age and reads as infinitely fresh — the same class of bug #3733 fixed on `getLiveOptionMarkSync()` but left on the async path that `live-marks.ts` uses for 0DTE P&L.

## Root cause

`src/lib/ws/options-socket.ts` `getLiveOptionMark()` lines 261–270 used raw subtraction for both in-memory and Redis hits while `getLiveOptionMarkSync()` already routed through `isWsUpdatedAtFresh()`.

## Fix

Route both async freshness checks through `isWsUpdatedAtFresh(local.ts, maxAgeMs)` / `isWsUpdatedAtFresh(hit.ts, maxAgeMs)`. Extend `options-socket-gate.test.ts` source-scan to assert async + sync + Redis paths.

## Evidence

- `npx tsx --test src/lib/ws/options-socket-gate.test.ts` — GREEN post-fix; RED on stash (async assertions missing)
- Pattern scan during hourly wake 2026-09-04T22:53Z

| **Status** | FIXED in PR |
