> **kind:** FINDING

## `seedUwCacheFromWsStores` over-claimed `net_flow`/`option_trades` WS coverage on the ops health metric — FIXED

| | |
|---|---|
| **Area** | `src/lib/uw-ws-cache-bridge.ts` (UW WS→Redis cache-seeding bridge, read by `GET /api/cron/uw-cache-refresh`) |
| **Status** | FIXED (this PR) |
| **Severity** | P3 — observability/ops metric only, no member-facing data path touched |

### Root cause

`seedUwCacheFromWsStores` reports which UW WS channels it managed to seed into Redis via a
`skipped_ws: string[]` array — the exact metric `uw-cache-refresh`'s own `off_lit_trades` fix
(the code immediately above this one, with its own extensive doc comment) names as "the one
WS-health metric (`ws_seeded`/`ws_skipped` on `GET /api/cron/uw-cache-refresh`) ops uses to tell
whether the WS bridge is actually covering this channel."

The `net_flow` and `option_trades` blocks had the *mirror-image* bug to the one `off_lit_trades`
was already fixed for:

- **`net_flow`**: entry was gated only on `isUwChannelFresh("net_flow", 120_000)` — not on whether
  any of the four tickers it loops over (`SPX`, `SPY`, `QQQ`, `IWM`) actually had ticks via
  `getNetPremTicksForTicker`. `skipped_ws.push("net_flow")` ran unconditionally *after* the loop,
  so a channel that was merely "recently delivered a message" (e.g. right after a reconnect, before
  any per-ticker store accumulated data) got reported as WS-covered even though zero Redis writes
  happened and `seeded` never incremented for it.
- **`option_trades`**: entry was gated on `isUwChannelFresh("option_trades", 120_000) &&
  optionTradesStore.rows.length > 0` — a market-wide, not per-ticker, check. If the rows currently
  buffered all belonged to a ticker this function doesn't write (or, more narrowly, to only one of
  `SPX`/`SPY` while the other never aggregates anything), the market-wide gate still passed while
  one or both of the actual per-ticker aggregations (`aggregateOptionTradesToStrikeRows`) could
  come back empty — and `skipped_ws.push("option_trades")` still ran unconditionally.

Both blocks previously lacked the `offLitSeeded`-style tracking boolean the `off_lit_trades` block
right above them already uses specifically to prevent this class of bug (see its own comment,
lines 47-54 of the same file) — it was applied to one channel but never propagated to its two
siblings on the exact same bridge function, the same "fixed N of M structurally identical blocks"
shape this repo's audit history keeps surfacing (see the `off_lit_trades`/`interval_flow`/
`net_flow`-row-ticker-default series in `src/lib/ws/uw-socket.ts`, #7306-#7309).

### Evidence

New tests in `src/lib/uw-ws-cache-bridge.test.ts`:
- `seedUwCacheFromWsStores does not claim net_flow coverage when the channel is fresh but no
  ticker produced any ticks`
- `seedUwCacheFromWsStores does claim net_flow coverage once at least one ticker produced ticks`
- `seedUwCacheFromWsStores does not claim option_trades coverage when the channel is fresh with
  rows but neither SPX nor SPY aggregated anything`
- `seedUwCacheFromWsStores does claim option_trades coverage once a ticker actually aggregates
  rows`

RED before the fix (confirmed via `git stash` on `uw-ws-cache-bridge.ts` alone, keeping the new
tests): 2/11 tests in the file failed — both "does not claim ... coverage" cases, with the function
returning `skipped_ws: ["net_flow"]` / `["option_trades"]` and `seeded: 0`. GREEN after the fix:
11/11. Full `npm test`: 18127 pass / 0 fail / 3 skipped (unrelated pre-existing skips).

### Blast radius

Only `seedUwCacheFromWsStores` in `src/lib/uw-ws-cache-bridge.ts` changed. `shouldSkipUwCacheRefreshTask`
(the function that actually decides whether to run the REST refresh per ticker/task) was already
re-deriving its own per-ticker freshness independently and is untouched — this fix changes only the
*reported* `ws_seeded`/`ws_skipped` values consumed by `GET /api/cron/uw-cache-refresh`'s JSON
response and cron logs, not any REST-skip or data-write decision. No member-facing read path is
affected.

### Fix rationale

Mirrored the exact `offLitSeeded` pattern already established for `off_lit_trades` two blocks
above: track whether the per-ticker loop actually wrote anything with a local boolean, and only
push the channel name onto `skipped_ws` when that boolean is true. Left `shouldSkipUwCacheRefreshTask`
untouched since it already computes freshness correctly per-ticker and does not read `skipped_ws`
at all.
