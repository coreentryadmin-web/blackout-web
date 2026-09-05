# 2026-09-05 — Swing active-refresh underlying spot stale last-trade guard

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Severity** | P1 |
| **Area** | `swing-active-refresh` structural_stop gate |
| **Status** | FIXED |

## Symptom

`loadUnderlyingSpot` in `swing-active-refresh/route.ts` read Polygon `/v2/last/trade` price (`p`) without checking the print timestamp. A stale-but-200-OK last trade (e.g. prior session) could feed `underlyingPrice` into `structural_stop`, falsely firing a real-money EXIT on a thesis that never broke intraday.

## Fix

Parse last-trade timestamp via `stockLastTradeAtMs` + `freshStockLastTradePrice` in `polygon-largo.ts` (25-minute default bound, `isWsUpdatedAtFresh`). `loadUnderlyingSpot` returns null when stale → position skipped this tick (fail-soft, no snapshot).

## Evidence

- `npx tsx --test src/lib/providers/polygon-largo.test.ts`
- `npx tsx --test src/app/api/cron/swing-active-refresh/route.test.ts`

## RTH validation

- Held swing position with pinned `thesis_invalidation_px`: confirm `swing-active-refresh` does not append a BROKEN structural_stop snapshot off a prior-session last trade at Monday open.
