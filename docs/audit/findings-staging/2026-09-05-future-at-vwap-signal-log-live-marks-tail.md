# Future-at guard tail — VWAP proxy, macro predictions, live-marks active set, stock candles

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Priority** | P2 |
| **Area** | SPX VWAP proxy / signal log / 0DTE live marks / stock candle Redis fallback |
| **PR** | (pending) |

## What was broken

Four remaining in-process caches used raw `now - fetchedAt < ttl` (or `<=`). Future stamps from cross-replica clock skew read as age 0 → cache pinned indefinitely:

- `spx-vwap-proxy.ts` — SPY volume map for session VWAP weighting
- `spx-signal-log.ts` — UW macro predictions consensus cache
- `live-marks.ts` — active open-play set (10s TTL)
- `stock-candle-store.ts` — Redis cross-replica fallback refresh gate

## What changed

Route all four through shared `isWsUpdatedAtFresh` from `@/lib/ws/timestamp-freshness`.

## RTH validation

- SPX desk VWAP label should still flip between volume-weighted and typical-price fallback correctly.
- SPX signal log macro shadow factor should refresh on TTL, not stick on skewed cache.
- Night Hawk open plays: active contract set should refresh within 10s after new commits.
- Stock live candles: cross-replica fallback should still refresh on demand.
