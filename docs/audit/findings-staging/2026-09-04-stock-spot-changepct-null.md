# Stock spot-stream fabricated 0% change — FIXED

> **kind:** FINDING

| Field | Value |
|---|---|
| **Status** | FIXED |
| **Severity** | P1 |
| **Area** | stock-candle-store / spot-stream |
| **PR** | (pending) |

## Symptom

`getStockLiveCandle()` returned `changePct: 0` when data was missing or stale, and `computeChangePct()` returned `0` without a session-open anchor — members saw a fabricated "flat day" instead of an honest absence.

## Fix

- `changePct` is now `number | null` on store snapshots and spot-stream quotes
- Missing/stale paths return `null`; `computeChangePct` returns `null` when `sessionOpen <= 0`

## Market-open validation

Subscribe to `/api/market/stocks/spot-stream?tickers=...` for a ticker with no WS data yet — frame should omit change or carry `null`, never `0` unless the day is genuinely flat.
