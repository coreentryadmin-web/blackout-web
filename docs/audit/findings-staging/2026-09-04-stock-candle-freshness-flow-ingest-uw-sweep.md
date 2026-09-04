# Stock candle store future-skew + flow-ingest UW sweep — 2026-09-04

> **kind:** FINDING

## Stock candle store: future `updatedAt` + fabricated `changePct: 0`

| Field | Value |
|---|---|
| **Severity** | P1 |
| **Area** | `src/lib/ws/stock-candle-store.ts`, `quote/route.ts` |
| **Status** | FIXED |

`getStockLiveCandle()` used raw `Date.now() - updatedAt` for freshness while `wsSpotPrice()` in the same file already used `isWsUpdatedAtFresh()`. A clock-skewed future `updatedAt` read as infinitely fresh. Empty/stale paths returned `changePct: 0`, which `/api/market/quote` served as a real flat day change.

**Fix:** shared `isWsUpdatedAtFresh` guard; `changePct: null` when absent/stale; quote route only forwards finite change values.

## flow-ingest cron missing `runWithBackgroundUwSweep`

| Field | Value |
|---|---|
| **Severity** | P1 |
| **Area** | `src/app/api/cron/flow-ingest/route.ts` |
| **Status** | FIXED |

REST fallback path called `runFlowIngest()` bare, unlike sibling UW fan-out crons — could exhaust the 2 RPS budget during RTH failover.

**Fix:** wrap in `runWithBackgroundUwSweep(() => runFlowIngest())`.
