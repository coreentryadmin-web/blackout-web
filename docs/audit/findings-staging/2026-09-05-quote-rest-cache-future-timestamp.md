# Quote REST cache future-timestamp guard

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **ID** | BO-P1-0107 |
| **Status** | FIXED |
| **Severity** | P1 |
| **Area** | `GET /api/market/quote` REST cache (L1 mem + L2 Redis) |

## Symptom

The shared REST quote cache (`quoteMem`, Redis `quote:{ticker}`) used `now - at < QUOTE_CACHE_MS` without a future-timestamp guard. Cross-replica clock skew could stamp `at` ahead of the reader's clock → negative age always passes the TTL check → stale quotes and rebased `change_pct` served as live on the Thermal header tape (~1.5s poll).

WS paths already guarded (`ageMs >= -WS_STALE_MS`); REST cache gates did not.

## Fix

- `isQuoteCacheAtFresh(at, now, ttlMs)` — requires `ageMs >= -WS_TIMESTAMP_FUTURE_TOLERANCE_MS` and `ageMs < ttlMs`.
- Applied to L1/L2 quote cache, failure negative-cache, `buildIndexWsQuote` REST baseline, and stock WS rebase path.

## Tests

- `src/app/api/market/quote/route-guards.test.ts` — source scan for helper + call sites.

## Market-open validation

- Poll `/api/market/quote?ticker=SPY` during RTH; confirm header price/change_pct track live spot when Redis writer clock skews (admin health → compare quote `asof` vs wall clock).
