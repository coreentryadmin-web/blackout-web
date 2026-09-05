# 2026-09-05 — Stock snapshot change_pct null + Night Hawk/anomalies roundFloats

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Severity** | P2 (change_pct fabrication) / P3 (API float noise) |
| **Area** | `polygon.ts` stock snapshots, market API routes |
| **Status** | FIXED |

## Symptom

1. `_rowToSnapshot` (single-ticker `fetchStockSnapshot`) fell through to `change_pct: 0` when `todaysChangePerc` and `prevDay.c` were both absent — presenting a flat day instead of honest absence. Batch paths were already fixed via `snapshotChangePctFromRow`.
2. `GET /api/market/anomalies`, `nighthawk/legacy-marks`, and `nighthawk/play-bars` served raw IEEE floats at the JSON boundary.

## Root cause

- `_rowToSnapshot` duplicated change-pct logic with a `: 0` fallback instead of reusing the null-safe batch helper semantics.
- Three Night Hawk / HELIX routes missed the `roundFloats` sweep applied to sibling market readers.

## Fix

- `StockQuoteSnapshot.change_pct` is `number | null`; `_rowToSnapshot` returns `null` when change cannot be derived.
- Wrap anomalies, legacy-marks, and play-bars success responses with `roundFloats(...)`.

## Evidence

- `polygon-snapshot-change-pct.test.ts` — `_rowToSnapshot` source scan + existing `snapshotChangePctFromRow` tests.
- `market-roundfloats-routes.test.ts` — route source scans.

## RTH validation

- Poll `GET /api/market/quote?ticker=ZZZZ` off-hours — `change_pct` should be absent/null, not `0`.
- Open Night Hawk Legacy play detail — marks and play-bars should show clean 2–4dp numbers, no `7499.360000000001` tails.
