# Polygon batch snapshot fabricates flat 0% when change is absent

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Area** | `polygon.ts` breadth / movers |
| **Severity** | P2 |

## Symptom

`fetchStockSnapshotPerformance` (sector ETFs, leader stocks, breadth universe) and
`fetchMarketMovers` used `todaysChangePerc ?? 0`, presenting a missing provider field as a
fabricated flat day. Downstream SPX desk `sector_heat` / breadth-derived TICK/TRIN proxies could
treat absent data as unchanged.

## Root cause

Batch snapshot paths did not share `_rowToSnapshot`'s null-or-derive discipline already applied to
single-ticker quotes and index snapshots.

## Fix

`snapshotChangePctFromRow()` — returns `null` when neither provider `%` nor day-close derivation
is available. Breadth internals skip null samples; movers list filters null change out.

## Evidence

`polygon-snapshot-change-pct.test.ts` + `tsc --noEmit` clean.

## Blast radius

`sector_heat`, `leader_stocks`, BIE movers bundle, Cortex breadth fetch, Largo breadth tools —
all now omit or null absent change instead of showing 0%.
