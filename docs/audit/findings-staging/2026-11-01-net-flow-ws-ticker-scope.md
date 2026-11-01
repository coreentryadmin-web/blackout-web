> **kind:** FINDING

## `net_flow` WS handler defaulted an unresolvable row's ticker to "SPX" — FIXED

| | |
|---|---|
| **Area** | `src/lib/ws/uw-socket.ts` — `net_flow` UW WebSocket channel handler |
| **Status** | FIXED (regression test added, RED→GREEN proven via `git stash`) |

### Root cause

`initUwSocket()`'s `net_flow` subscribe handler determined each row's ticker with:

```ts
const ticker = String(r.ticker ?? r.symbol ?? "SPX").toUpperCase();
if (!NET_FLOW_TICKERS.has(ticker)) continue;
```

`net_flow` is joined **per-ticker** — `joinWiresForChannel("net_flow")` sends four separate
wire subscriptions, `net_flow:SPX`, `net_flow:SPY`, `net_flow:QQQ`, `net_flow:IWM` (the
default `UW_WS_NET_FLOW_TICKERS` set). But `UwSocketManager.handleMessage` strips the wire's
own `:TICKER` suffix before dispatch (`channelFromWireName` splits on `:` and returns only
the base channel), and routes every one of those four subscriptions into the **same**
base-channel `"net_flow"` handler. The handler therefore has no way to tell which of the
four tickers a given frame belongs to except from the payload's own `ticker`/`symbol`
field — and if a frame ever omits both (the exact same "wire suffix carries the identity,
payload doesn't repeat it" shape already found, live, on two sibling channels on this same
multiplexed socket — `off_lit_trades` in #7307 and `interval_flow` in #7308), the old code
silently guessed `"SPX"`.

That default fed straight into `recordNetFlowForTicker`, which special-cases `sym === "SPX"`
to overwrite the **shared, legacy `netFlowStore` snapshot** — the one store
`src/features/spx/lib/spx-desk.ts`'s net-flow panel and `src/lib/uw-ws-cache-bridge.ts`'s
`uw_cache:net_prem_ticks:SPX` Redis seed both treat as ground truth for "SPX net call/put
premium". An ambiguous SPY/QQQ/IWM row would have silently overwritten that SPX-labeled
read with another ticker's premium data, with no error, no stale-flag, and no way for a
downstream reader to tell the difference — the same failure shape #7307/#7308 already fixed
for their own channels (first found live in production for `off_lit_trades`).

### Evidence

- `joinWiresForChannel` (uw-socket.ts, `net_flow` branch): joins `net_flow:${t}` for each of
  `SPX,SPY,QQQ,IWM` by default — four ticker-scoped subscriptions, confirmed by reading the
  function directly.
- `UwSocketManager.handleMessage`: `const wireChannel = String(parsed[0] ?? ""); const
  channel = channelFromWireName(wireChannel); ... this.dispatch(channel, parsed[1]);` — the
  wire's ticker suffix is read only to resolve the base channel, then discarded; only
  `parsed[1]` (the raw payload, no channel/ticker tag) reaches the subscribed handler.
- Every sibling WS normalizer in `src/lib/providers/unusual-whales.ts` that shares this same
  "ticker must come from the payload itself" constraint (`normalizeLitTradesWsPayload`,
  `normalizePriceWsPayload`, `normalizeOptionTradesWsPayload`) requires a real
  `ticker`/`symbol` field and **drops** the row when absent — `net_flow`'s inline handler was
  the one place on this socket still defaulting an unresolvable row to a specific ticker
  instead of dropping it.
- Regression test `src/lib/ws/uw-socket-net-flow.test.ts` (`parseNetFlowWsRow`): a row with
  no `ticker`/`symbol` field now returns `null` (dropped) instead of being attributed to
  `"SPX"`. Proven RED→GREEN: before the fix the test fails because `parseNetFlowWsRow` did
  not exist as an exported pure function (the logic was inline and unresolvable-to-null
  behavior was absent); after extracting it with the fix, all 5 new tests pass, and the
  full `uw-socket*`/`unusual-whales` test files (67 tests) still pass with no regressions.

### Blast radius

Single handler, single file (`src/lib/ws/uw-socket.ts`): the `net_flow` subscribe callback
inside `initUwSocket()`. Downstream consumers of the corrected store
(`netFlowStore`/`netFlowByTicker`/`getNetPremTicksForTicker`) — `spx-desk.ts`'s net-flow
panel and `uw-ws-cache-bridge.ts`'s `seedUwCacheFromWsStores` — are unaffected by any
behavior change for a well-formed row (same ticker extraction, same math); they only stop
seeing a *wrong-ticker* value substituted for SPX on the ambiguous-row path, which is the
fix. No other channel handler on this socket shares this exact inline pattern — `lit_trades`,
`price`, `option_trades`, `gex_strike_expiry`, and `trading_halts` handlers were all checked
this round and already delegate to a normalizer that requires an explicit ticker and drops
the row otherwise (fail-closed by construction, not fail-dangerous).

### Fix rationale

Extracted the per-row parsing into a pure, exported `parseNetFlowWsRow()` (mirroring the
`bucketIntervalFlowRows()` extraction #7308 used for the same reason: testability + a single
place to express "never guess a ticker"). It returns `null` — row dropped, no store touched,
`recordUwDelivery`/`recordNetFlowForTicker` never called — whenever `ticker`/`symbol` is
missing, instead of defaulting to `"SPX"`. A row that does carry an explicit, recognized
ticker behaves identically to before (same math, same `NET_FLOW_TICKERS` filter). This is
the same fail-closed discipline already shipped for `off_lit_trades`/`interval_flow` and
already used by every other normalizer on this socket — deliberately NOT changing
`NET_FLOW_TICKERS` itself (membership set) or `joinWiresForChannel`'s join list, since
neither is the defect; only the "what do we do when the ticker is unknown" branch changed.
