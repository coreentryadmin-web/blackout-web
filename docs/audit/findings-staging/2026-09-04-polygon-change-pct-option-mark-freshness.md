# Polygon breadth/movers fabricated 0% + async option-mark future guard

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Priority** | P1 |
| **Area** | polygon.ts, options-socket.ts |
| **Branch** | fix/polygon-change-pct-and-option-mark-freshness |

## Symptom

- `fetchStockSnapshotPerformance` / `fetchMarketMovers` defaulted missing `todaysChangePerc` to `0`, fabricating flat day-change on SPX breadth leaders, sector heat, and Thermal movers.
- `getLiveOptionMark` (async) used raw `now - ts <= maxAgeMs` while sync path already used `isWsUpdatedAtFresh` — clock-skewed future WS quote stamps could read as fresh on the 0DTE live-mark path.

## Root cause

Incomplete application of the FIX-A change_pct / future-timestamp sweeps (#3769 class): grouped snapshot performance path never derived from `prev_close`, and async option-mark Redis fallback missed the guard added to `getLiveOptionMarkSync` in the source-scan test.

## Fix

- `snapshotPerformanceChangePct()` — prefer `todaysChangePerc`, else derive from `prev_close`, else omit (filter null from breadth arrays).
- `getLiveOptionMark` local + Redis paths gate through `isWsUpdatedAtFresh`.

## Evidence

- `npx tsx --test src/lib/providers/polygon-index-change.test.ts src/lib/ws/options-socket-gate.test.ts` — 7/7 pass
- `npx tsc --noEmit` — clean
