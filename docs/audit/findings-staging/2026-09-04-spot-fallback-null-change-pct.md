# 2026-09-04 — UW spot fallback null change_pct

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Severity** | P1 |
| **Area** | `src/lib/providers/spot-fallback.ts`, `/api/market/quote` UW fallback path |
| **Status** | FIXED |

## Symptom

When UW `/stock-state` returned a price without `prev_close`, `resolveSpotFromUwStockState` set `change_pct: 0` — a fabricated flat 0% move shown on quote headers.

## Root cause

`prev > 0 ? compute : 0` coalesced unknown prior-close to zero instead of `null`, unlike `resolveSpotSnapshot` and `QuotePayload` semantics elsewhere.

## Fix

Return `change_pct: null` when `prev_close` is absent or non-positive.

## Evidence

- Source-scan regression: `spot-fallback.test.ts`
- Pattern scan from hourly checklist §3 (2026-09-04)

## RTH validation

- Poll `/api/market/quote?ticker=<thin-name>` when UW stock-state lacks prev_close — `change_pct` should be `null`, not `0`.
