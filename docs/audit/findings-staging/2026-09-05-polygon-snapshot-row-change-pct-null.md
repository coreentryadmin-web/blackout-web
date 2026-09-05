# Polygon single-ticker snapshot fabricated flat 0% change_pct

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **ID** | BO-P2-2026-09-05-polygon-row-change-pct |
| **Priority** | P2 |
| **Status** | FIXED |
| **Area** | `src/lib/providers/polygon.ts` |

## Symptom

`fetchStockSnapshot()` → `_rowToSnapshot()` returned `change_pct: 0` when Polygon omitted `todaysChangePerc` and `prevDay.c`, presenting a flat session when no basis existed.

## Root cause

Batch movers already used `snapshotChangePctFromRow()` (null when absent). The single-ticker `_rowToSnapshot` path still had a `: 0` fallback tail.

## Fix

Wire `_rowToSnapshot` to `snapshotChangePctFromRow(row)` and type `StockQuoteSnapshot.change_pct` as `number | null`.

## Evidence

`src/lib/providers/polygon-snapshot-change-pct.test.ts` — structural guard on `_rowToSnapshot`.

## Market-open check

Off-hours: `/api/market/quote?ticker=SPY` with a mock absent `prevDay` should omit change % (null), not show `0.00%`.
