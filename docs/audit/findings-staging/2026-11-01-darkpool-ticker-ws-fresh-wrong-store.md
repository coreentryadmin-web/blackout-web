> **kind:** FINDING

## Night Hawk-adjacent? No — generic UW WS cache-bridge bug (`src/lib/uw-ws-cache-bridge.ts`) — FIXED

### Root cause
`shouldSkipUwCacheRefreshTask("dark_pool_ticker", "SPX")` decides whether the
`uw-cache-refresh` cron should skip its REST fallback for the `UW_KEYS.darkPoolTicker("SPX")`
Redis key, on the theory that the UW WebSocket bridge already covers it. Before this fix it
reused `darkPoolWsFresh()` — the SAME freshness check `dark_pool_recent` uses, which is gated on
`darkPoolRecentRing` (the market-wide ring of raw off-lit rows).

But `UW_KEYS.darkPoolTicker("SPX")` is not written from that ring. `seedUwCacheFromWsStores`
writes it from a completely different store, `darkPoolStore` (see `uw-ws-cache-bridge.ts:60-64`).
The two stores are independent parses of the SAME `off_lit_trades` WebSocket payload, done inside
`uw-socket.ts`'s subscribe handler:

- `extractDarkPoolRawRows(payload)` → feeds `darkPoolRecentRing` (`pushDarkPoolRawRows`). It has
  **no premium filter and no date filter** — any object in the payload is accepted.
- `normalizeDarkPoolWsPayload(payload)` → feeds `darkPoolStore`. It **drops any row with
  `premium <= 0`** and **drops any row whose `executed_at` isn't today's ET session**, and returns
  `null` (leaving `darkPoolStore` untouched) when nothing survives those filters.

So a WS frame can keep the ring "fresh" (e.g. a batch of zero-premium block prints, or prints
carrying a prior-session `executed_at` near a session boundary) while `darkPoolStore` goes stale
— `darkPoolStore.updatedAt` simply stops advancing. Using the ring's freshness to answer "is the
ticker-level store fresh" was checking the wrong store entirely.

### Evidence
- `src/lib/uw-ws-cache-bridge.ts`'s own in-code comment (lines 44-51, pre-existing) already
  documents that the ring and the ticker store "can fire alone" — i.e. the codebase already knew
  they are independent — but the skip-decision function did not act on that fact.
- Regression test added in `src/lib/uw-ws-cache-bridge.test.ts`
  (`shouldSkipUwCacheRefreshTask('dark_pool_ticker','SPX') does not skip REST when the ring is
  fresh but the ticker-level store is stale`): mocks `darkPoolRecentRing` fresh (rows + recent
  `updatedAt`) and `darkPoolStore` stale (`data: null`, `updatedAt: 0`). RED before the fix
  (`shouldSkipUwCacheRefreshTask` returned `true`, confirmed via `git stash`/`git stash pop`),
  GREEN after.
- Sibling test confirms the positive case is unaffected: once `darkPoolStore` itself is fresh,
  the task is still correctly skipped.

### Blast radius
Single call site: `GET /api/cron/uw-cache-refresh` (`src/app/api/cron/uw-cache-refresh/route.ts:88`)
is the only caller of `shouldSkipUwCacheRefreshTask("dark_pool_ticker", ticker)`. When this
divergence occurs during RTH, the cron silently treats `dark_pool_ticker:SPX` as WS-covered and
never falls back to REST, while the WS side also never refreshes it (its own seed condition
requires the same stale `darkPoolStore`) — the key goes stale with no path left to refresh it
until a WS frame happens to carry a fresh, same-day, positive-premium SPX print again. No other
caller reads `darkPoolWsFresh()`/`darkPoolTickerWsFresh()`, so the fix is local to this one
decision path.

### Fix rationale
Split the one shared `darkPoolWsFresh()` (ring-based, still correct for `dark_pool_recent`) into
two functions: keep `darkPoolWsFresh()` for the ring-fed task, and add `darkPoolTickerWsFresh()`
that checks `darkPoolStore` — the exact store `seedUwCacheFromWsStores` reads for that key — for
the `dark_pool_ticker`/SPX task. This mirrors the write-side condition exactly (same
`isUwChannelFresh("off_lit_trades", ...)` gate plus `darkPoolStore.updatedAt > 0 && darkPoolStore.data`),
so the skip-decision and the seed-decision can never disagree about which store backs that key.
Deliberately left unchanged: the `normalizeDarkPoolWsPayload`/`extractDarkPoolRawRows` filtering
logic itself, and the pre-existing "ring can fire alone" accounting comment/behavior in
`seedUwCacheFromWsStores` — both are correct and out of scope for this fix, which is confined to
the read-side freshness check.
