# 2026-09-04 — Polygon change_pct null-not-zero + dark-pool roundFloats

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Severity** | P2 |
| **Area** | Polygon provider + HELIX dark-pool API |
| **Status** | FIXED |

## Symptom

1. `polygon.ts` `_rowToSnapshot`, sector performance, and market movers defaulted missing `todaysChangePerc` to `0`, fabricating a flat +0.00% on Thermal heatmap sectors/movers and REST quote fallback.
2. `/api/market/dark-pool` and `/api/market/dark-pool/ticker` returned raw IEEE floats on `premium` without `roundFloats` at the JSON boundary.

## Root cause

Provider helpers used `?? 0` when Polygon omitted session change and no prior close could ground a percentage. Dark-pool routes were never enrolled in the API-boundary rounding sweep that covered `/api/market/flows`.

## Fix

- `_changePctFromSnapshotRow()` returns `null` when ungrounded; shared by snapshot, sector, and mover paths.
- `StockQuoteSnapshot.change_pct` typed `number | null`.
- Both dark-pool routes wrap success payloads in `roundFloats(...)`.

## Evidence

- `polygon-change-pct-snapshot.test.ts` — source scan rejects `?? 0` fabrication.
- `dark-pool-roundfloats.test.ts` — both routes import and call `roundFloats`.

## RTH validation

- `/heatmap` sector tape: names with missing Polygon session change should show absence, not +0.00%.
- HELIX dark-pool tape: premium values should be 2dp with no float tails.
