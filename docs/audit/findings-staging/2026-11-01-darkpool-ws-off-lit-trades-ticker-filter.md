> **kind:** FINDING

## off_lit_trades is a market-wide WS channel but its normalizer had no ticker filter — a non-SPX print can silently overwrite the SPX dark-pool cache slot — FIXED

| | |
|---|---|
| **Status** | Fixed |
| **Severity** | P2 (data-integrity — wrong institutional-flow signal served under the SPX key) |
| **Files** | `src/lib/providers/unusual-whales.ts`, `src/lib/ws/uw-socket.ts`, `src/lib/providers/uw-ws-normalize.test.ts` |

### Root cause

`off_lit_trades` (UW's dark-pool-print WS channel) is joined **unscoped** — `joinWiresForChannel`
in `src/lib/ws/uw-socket.ts` has a per-channel ticker-scoping branch for `net_flow`,
`option_trades`, `lit_trades`, `gex_strike_expiry` and `price` (each joined as `name:TICKER`),
but **no branch for `off_lit_trades`**, so it falls through to the bare default
`[CHANNEL_JOIN_NAME[channel]]` → `["off_lit_trades"]` with no ticker suffix. This is a genuinely
market-wide subscription — confirmed by the cache-bridge's own comment
(`src/lib/uw-ws-cache-bridge.ts` lines 44-51), which explicitly distinguishes "the market-wide
recent-ring (`dark_pool_recent`)" from "the SPX ticker-level snapshot
(`dark_pool:SPX:...`)" fed by the SAME channel.

Despite that, `normalizeDarkPoolWsPayload` (`src/lib/providers/unusual-whales.ts`) aggregated
**every row in the WS frame** into one `DarkPoolSnapshot` with no ticker filter, and the
`off_lit_trades` subscribe handler in `uw-socket.ts` stamped that unfiltered snapshot directly
onto `darkPoolStore.data`, which `uw-ws-cache-bridge.ts`'s `seedUwCacheFromWsStores` then writes
unconditionally to `UW_KEYS.darkPoolTicker("SPX")`. A single market-wide WS frame carrying any
other ticker's dark-pool block trade (AAPL, TSLA, etc.) — the common case, since the SPX index
itself does not print dark-pool block trades under the literal ticker `"SPX"` the way single-name
equities do — got blended into, or in the single-ticker-frame case entirely replaced, the
snapshot cached under the SPX key.

### Evidence

- `joinWiresForChannel` source (uw-socket.ts): every other channel has an explicit ticker-scoped
  join branch; `off_lit_trades` has none and falls to the unscoped default.
- `uw-ws-cache-bridge.ts`'s own inline comment (lines 44-51) names `off_lit_trades` as feeding
  both "the market-wide recent-ring" and "the SPX ticker-level snapshot" from the same channel —
  i.e. the code's own documentation already states the channel is market-wide.
- Added regression test `normalizeDarkPoolWsPayload scopes to onlyTicker...`
  (`uw-ws-normalize.test.ts`): a WS frame mixing an AAPL print ($5M) with a real SPX print ($1M)
  — before the fix, `normalizeDarkPoolWsPayload(mixed)` (the only call signature that existed)
  returned `total_premium: 6,000,000` with both prints blended; a frame containing ONLY a TSLA
  print returned a non-null snapshot that would have silently overwritten the SPX cache slot.
  Proved RED→GREEN via `git stash` on the two source files (test alone: 1 failing assertion,
  `2 !== 1` print count; test + fix: 10/10 pass).

### Blast radius

- `src/lib/providers/unusual-whales.ts`: `normalizeDarkPoolWsPayload` gains an optional
  `onlyTicker` parameter, default-unfiltered (no behavior change for any caller that omits it,
  including the existing precision test which deliberately uses a non-SPX `symbol`).
- `src/lib/ws/uw-socket.ts`: the `off_lit_trades` subscribe handler is the only real caller;
  updated to pass `"SPX"`.
- `darkPoolRecentRing` / `UW_KEYS.darkPoolRecent()` (the market-wide ring) is **untouched** —
  that key is intentionally unfiltered per its own name/purpose; only the ticker-scoped
  `UW_KEYS.darkPoolTicker("SPX")` slot was wrongly receiving unfiltered data.
- Downstream consumer `readUwDarkPoolFromRedis("SPX")` → `spx-desk.ts` is out of scope for this
  fix (hard-excluded lane) and was not touched; the fix is confined to the normalizer/WS-handler
  layer per the standing instruction, and benefits that consumer without editing it.

### Fix rationale

Added an optional `onlyTicker` filter to `normalizeDarkPoolWsPayload` rather than filtering rows
at the call site in `uw-socket.ts`, because the ticker-resolution logic (`r.ticker ?? r.symbol ??
r.underlying`) already lives inside the normalizer and duplicating it at the call site would risk
drifting out of sync. The parameter is optional and defaults to the prior unfiltered behavior so
every other caller (and the existing non-SPX-fixture test) is unaffected — this is a minimal,
additive change, not a rewrite of the function's row-parsing logic.
