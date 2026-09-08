# 2026-09-04 — UW spot-fallback fabricated 0% when prev_close missing

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Severity** | P1 |
| **Area** | UW `/stock-state` spot fallback (`spot-fallback.ts`) |
| **Status** | FIXED |

## Symptom

When UW `/stock-state` returned a valid price but omitted `prev_close`, `resolveSpotFromUwStockState()` emitted `change_pct: 0` — members saw "unchanged on the day" when the platform had no basis to compute day change.

## Root cause

`prev_close` defaulted to `0` via `Number(row.prev_close ?? row.previous_close ?? 0)`; the ternary then fell through to `change_pct: 0` instead of honest absence.

## Fix

`SpotQuote.change_pct` is now `number | null`; when `prev_close` is missing or non-positive, return `null` instead of `0`.

## Blast radius

- `GET /api/market/quote` UW fallback path
- `seedPulseSnapshotFromUwPrices()` in `socket-cluster-health.ts` (already types `change_pct` as `number | null`)

## Evidence

`src/lib/providers/spot-fallback.test.ts` — source scan asserts null-not-zero semantics.

## RTH validation

Poll `GET /api/market/quote?ticker=<equity>` when UW stock-state is the active fallback — if UW omits prior close, `change_pct` should be absent/null, not `0`.
