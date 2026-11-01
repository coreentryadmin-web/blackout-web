> **kind:** FINDING

## Stock/ETF spot-stream SSE pushed WS ticks up to 60s stale as "live", bypassing the quote route's 10s freshness bar — FIXED

| | |
|---|---|
| **Area** | `src/lib/ws/stocks-spot-stream-hub.ts` (`GET /api/market/stocks/spot-stream`) |
| **Severity** | P2 — member-visible, silent data-correctness/latency defect, no crash/error |
| **Status** | FIXED (`fix/spot-stream-staleness-gate`) |

### Root cause

`/api/market/quote` (`src/app/api/market/quote/route.ts`) only trusts a WS tick from
`getStockLiveCandle()` as "live" when it is fresher than its own local `WS_STALE_MS = 10_000`
(10s) — anything older falls through to a fresh REST snapshot instead (see the route's own
comment: "store cold/stale → fall through to the shared-cached index REST snapshot", and the
mirrored stock-candle branch a few lines below it).

The generalized push stream (`/api/market/stocks/spot-stream`, built in the later "sub-second-spot"
project, PR 2/3) reads the exact same underlying store (`getStockLiveCandle`) but had **no
equivalent ceiling** of its own. `buildSpotFrame()` only checked `candle.current && candle.current
.close > 0` — and `getStockLiveCandle()` itself only enforces a much looser internal
`MAX_CANDLE_AGE_MS = 60_000` (60s) before returning `current: null`. So a WS tick anywhere in the
10-60s-old range (routine for a lightly-traded ticker whose WS prints are naturally sparse — a
quiet tape between trades, not an error condition) was pushed over SSE labelled "live" with **no
REST fallback at all**.

On the client, `useLiveQuoteStream` (and its only call site, `GexHeatmap.tsx`'s `stockPushLive`)
unconditionally prioritizes whatever this stream sends over the REST `/api/market/quote` SWR
result, with no staleness check of its own — by design, per the hook's own doc comment ("a ticker
absent from `quotes` means the server hasn't seen a live tick for it yet ... callers should keep
showing their last-known REST/SWR value until it appears here"). That comment already documents
the intended server-side contract: an entry's PRESENCE in the frame is supposed to mean "this is
genuinely live", so the client can trust it blindly — but the implementation only ever omitted
*literally-null* candles, never *stale-but-present* ones, so the contract the client already
relies on wasn't actually being kept.

**Net effect:** for a lightly-traded ticker with a WS tick 10-60s old, the Thermal/Heat Maps header
(and any other `useLiveQuoteStream` consumer) could display a stale price/day-change% labelled
"live", silently overriding a correct, fresher `/api/market/quote` REST value — for up to a
minute, with no visible error or stale indicator.

### Evidence (RED → GREEN)

Added `src/lib/ws/stocks-spot-stream-hub.test.ts`: `"buildSpotFrame: omits a ticker whose WS tick
is stale beyond the quote route's own freshness bar"`. Using the existing `_skewLocalUpdatedAtForTest`
test hook (already used by `stock-candle-store.test.ts` for the analogous future-skew case) to push
a ticker's `updatedAt` 15s into the past — past the quote route's 10s bar, but comfortably inside
the candle store's own 60s `MAX_CANDLE_AGE_MS` (so `getStockLiveCandle()` alone still returns a
non-null `current` for it):

- **Pre-fix (RED):** `buildSpotFrame(["ILLQ"])` still returned the 15s-stale quote
  (`{ price: 42, changePct: null, asof: ... }`) — the exact bug.
- **Post-fix (GREEN):** `buildSpotFrame(["ILLQ"]).quotes.ILLQ` is `undefined`; the sanity assertion
  (present while genuinely fresh) still holds.

Full `stocks-spot-stream-hub.test.ts` suite: 13/13 pass post-fix. Sibling
`stock-candle-store.test.ts` (22/22) and `quote/route.test.ts` (4/4) unaffected — confirms the fix
is scoped to this hub and doesn't change `getStockLiveCandle()`'s own (correct, 60s) contract.
`npx tsc --noEmit` clean.

### Blast radius

Only one call site reads `buildSpotFrame`: the SSE route (`src/app/api/market/stocks/spot-stream/route.ts`).
Only one hook consumes that stream: `useLiveQuoteStream` (`src/hooks/useLiveQuoteStream.ts`), whose
only current call site is `GexHeatmap.tsx`'s `stockPush`/`stockPushLive` header-overlay logic. No
other consumer exists today, so the fix's effect is fully contained to that one header's live-price
overlay — it simply stops firing (falls back to the REST quote, per the hook's own documented
contract) for a ticker whose WS tick is 10-60s stale, instead of firing with stale data.

### Fix rationale

Added a local `SPOT_STREAM_WS_STALE_MS = 10_000` constant (deliberately duplicated rather than
imported — the quote route doesn't export its own `WS_STALE_MS`, and importing a route module into
a shared `lib/ws/` hub would be the wrong dependency direction; this repo already has the identical
documented tradeoff for `GEX_INDEX_WS_STALE_MS` in `polygon-options-gex.ts`, which mirrors
`spx-desk`'s `INDEX_STORE_STALE_MS` the same way) and gated `buildSpotFrame`'s inclusion check on
`isWsUpdatedAtFresh(candle.updatedAt, SPOT_STREAM_WS_STALE_MS)` — the same shared helper
`getStockLiveCandle()` itself already uses internally, so the freshness semantics (clock-skew
tolerance included) stay identical between the two layers.

Deliberately left unchanged: `getStockLiveCandle()`'s own `MAX_CANDLE_AGE_MS` (60s) — that bound is
correct for ITS contract (how long a candle may still be served to ANY internal caller, including
ones with looser freshness needs); this fix only tightens the ceiling at the one caller
(`buildSpotFrame`) whose documented behavior ("live" push, REST-equivalent freshness) requires it.
Also left unchanged: the REST-fallback-less design of this SSE lane itself (per its own header
comment, it is a push-only overlay, not a REST-equivalent path) — omitting a stale ticker and
letting the client's documented "keep last-known REST value" behavior take over is the existing,
intended degradation path, not a new one.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PzDkDzjR3bJQsFbXENzsVz
