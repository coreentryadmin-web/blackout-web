# 2026-09-04-flow-ingest-uw-sweep-candle-freshness

> **kind:** FINDING

## flow-ingest missing UW background-sweep tag + candle-store future-skew freshness

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Priority** | P1 (flow-ingest), P2 (candle freshness) |
| **Area** | UW rate limiter, WS candle stores |

### Root cause

1. **`flow-ingest` cron** called `runFlowIngest()` bare. That function hits `fetchMarketFlowAlertRows` (UW REST) but was the one remaining UW-heavy cron not wrapped in `runWithBackgroundUwSweep`, unlike `uw-cache-refresh`, `desk-warm`, `vector-pick-sweep`, etc. During RTH this competes for the cluster-wide 2 RPS UW budget and can starve live member flow-alerts requests.

2. **`getStockLiveCandle` / `getCurrentSpxCandle`** used raw `Date.now() - updatedAt` for freshness. A clock-skewed future `updatedAt` yields negative age → treated as infinitely fresh. `wsSpotPrice` on the same store already used `isWsUpdatedAtFresh()` but the candle read path did not.

### Fix

- Wrap `runFlowIngest()` in `runWithBackgroundUwSweep` in `src/app/api/cron/flow-ingest/route.ts`.
- Route candle freshness through `isWsUpdatedAtFresh()` in `stock-candle-store.ts` and `spx-candle-store.ts`.

### Evidence

- Regression tests: `flow-ingest/route.test.ts`, `stock-candle-store.test.ts` (future-skew case).
- Pre-fix: audit sweep 2026-09-04 identified flow-ingest as sole unwrapped UW REST cron.

### RTH validation

- CloudWatch: no `[uw] flow-alerts failed: rate-limiter queue budget exceeded` clustering at flow-ingest fire times.
- Vector SSE / spot stream: no candles served with `updatedAt` >5s in the future during deploy rollouts.
