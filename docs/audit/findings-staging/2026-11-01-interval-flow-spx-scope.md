> **kind:** FINDING

## `interval_flow` WS handler stamped OTHER tickers' rows onto the SPX-labeled snapshot — FIXED

| **Status** | FIXED |
|---|---|

### Root cause

`src/lib/ws/uw-socket.ts`'s `interval_flow` subscribe handler built a `byTicker` map
correctly bucketing every normalized row by its own ticker, but then computed the
legacy single-ticker `intervalFlowStore` (the value `/api/market/spx/pulse/stream`
serves to clients as `intervalFlow`, i.e. "SPX's interval-flow rows") as:

```ts
const spx = byTicker.get("SPX");
intervalFlowStore.rows = spx ?? rows;
```

`interval_flow` is joined **unscoped** in `joinWiresForChannel` — unlike `net_flow`,
`option_trades`, `lit_trades`, `gex_strike_expiry` and `price`, which each have an
explicit `channel:TICKER` join branch, `interval_flow` falls through to the function's
default case and joins the bare channel name with no ticker suffix. This is the exact
same market-wide-feed shape `off_lit_trades` has (fixed in #7307) — UW pushes
interval-flow rows for whatever tickers it chooses in a single frame, not scoped to one
symbol per join.

So whenever a WS frame carried rows for OTHER tickers only (e.g. a pure AAPL or TSLA
interval-flow push, with zero SPX rows in that particular frame — the common case,
since the SPX index itself is far from the only subject of this channel), `byTicker.get("SPX")`
was `undefined` and the code fell back to `rows` — the ENTIRE unfiltered frame, across
whichever other ticker(s) it actually contained — and stamped that onto
`intervalFlowStore`, the slot every consumer reads as "SPX's own interval flow."

### Evidence

- `joinWiresForChannel` (`uw-socket.ts`): explicit ticker-scoped branches exist for
  `net_flow`/`option_trades`/`lit_trades`/`gex_strike_expiry`/`price`; `interval_flow`
  has none and hits the unscoped default (`return [CHANNEL_JOIN_NAME[channel]]`).
- `/api/market/spx/pulse/stream/route.ts` reads `intervalFlowStore.rows` directly and
  serves it to clients as `intervalFlow` inside the SPX pulse SSE payload — the exact
  consumer that would have displayed another ticker's strike-level flow as if it were
  SPX's.
- New regression test `uw-socket-interval-flow.test.ts`: a frame containing only two
  AAPL rows — before the fix, the equivalent inline logic (`spx ?? rows`) would have
  returned the AAPL rows as the SPX snapshot; after the fix, `bucketIntervalFlowRows`
  returns `spxRows: null` for that frame, leaving `intervalFlowStore` untouched rather
  than contaminated. Proved RED→GREEN via `git stash`: test alone against the pre-fix
  source fails all 3 assertions (`bucketIntervalFlowRows` didn't exist yet, since the
  logic was inline and unextracted); test + fix passes 3/3, and the sibling
  `uw-socket-gate.test.ts`/`uw-socket-stall.test.ts` files (27 tests total) still pass.

### Blast radius

- `src/lib/ws/uw-socket.ts`: only the `interval_flow` subscribe handler changed. The
  per-ticker `intervalFlowByTicker` map (read by `getIntervalFlowForTicker(ticker)` for
  any non-SPX caller) was already correct and is unchanged in behavior — it still
  receives every ticker's rows every frame.
- `intervalFlowStore.updatedAt` now only advances on a frame that genuinely carries an
  SPX row, rather than on every frame regardless of ticker. This is a deliberate,
  correct side effect: downstream staleness checks (`intervalFlowStore.updatedAt > 0`)
  can no longer read a stale/wrong-ticker snapshot as "fresh" just because an unrelated
  ticker's frame arrived.
- `src/app/api/market/spx/pulse/stream/route.ts` (the consumer) was not touched —
  the fix is confined to the WS-handler layer and benefits that consumer without
  editing it, same as #7307's fix for `off_lit_trades`/`darkPoolStore`.

### Fix rationale

Extracted the bucketing logic into an exported pure function,
`bucketIntervalFlowRows`, so the SPX-only subset can be tested directly without
standing up a real WS connection (`initUwSocket()` opens a live socket and isn't
unit-testable), and so the handler's fix (`if (spxRows) { ... }` instead of
`spx ?? rows`) is a minimal, obviously-correct one-line change at the call site. This
mirrors #7307's precedent for the structurally identical `off_lit_trades` bug: never
let a market-wide channel's other-ticker rows overwrite a ticker-specific cached slot.
The per-ticker `intervalFlowByTicker` map's own update loop is untouched — it was
never the buggy half.
