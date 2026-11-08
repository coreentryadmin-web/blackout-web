## 2026-11-08 — [FINDING, P2] SPX WS dark-pool snapshot silently discarded earlier session prints on every new frame — FIXED

> **kind:** FINDING

| | |
|---|---|
| **Area** | `src/lib/ws/uw-socket.ts` (`off_lit_trades` WS handler, `darkPoolStore`) |
| **Status** | FIXED |
| **Severity** | P2 — wrong (understated) live `$` totals and bias/pcr on a real, frequently-read field, not a crash |

### Root cause

Round 417 flagged this as worth a dedicated investigation rather than a rushed fix: on every
`off_lit_trades` WebSocket frame, `darkPoolStore.data` was **flatly overwritten** —

```ts
const normalized = normalizeDarkPoolWsPayload(payload, "SPX");
if (normalized) {
  recordUwDelivery("off_lit_trades");
  darkPoolStore.data = normalized;        // <-- overwrites, does not accumulate
  darkPoolStore.updatedAt = Date.now();
}
```

`normalizeDarkPoolWsPayload` builds a full `DarkPoolSnapshot` (`total_premium` /
`call_premium` / `put_premium` / `bias` / `pcr` / `detail`) from **only the rows in the current
frame** — `off_lit_trades` delivers individual trade objects per frame (per this function's own
header comment), not a day-aggregate. That is the exact same shape the REST-path day-aggregate
functions (`fetchUwDarkPool`/`fetchUwDarkPoolMarketWide`) produce by summing **every** qualifying
row seen today — so every downstream reader treats `darkPoolStore.data` as a running SESSION
total, not a single tick.

This investigation confirmed it is a real, consumer-facing bug, not a "latest snapshot by design"
non-issue (the question round 417 posed):

1. **The channel is market-wide, SPX prints are rare.** `off_lit_trades` has no `:TICKER` join
   suffix — it streams every ticker's dark-pool block trades. A genuine `ticker === "SPX"` print
   is an uncommon event on this feed (per the module's own comment: "the index itself never
   actually dark-pool-prints under the ticker SPX the way single-name equities do"). So two real,
   separately-executed SPX prints in one session (e.g. $5M at 10am, $3M at 2pm) are exactly the
   case this bug hits: the 2pm frame's normalize call replaced the 10am print's contribution
   instead of adding to it — the $5M simply vanished from `total_premium`/`bias`/`pcr`, not
   because the trading day un-happened, but because nothing accumulated it. Dark-pool prints are
   executed trades already on the tape — a session's set cannot shrink (the same invariant
   `fetchUwDarkPool`'s own comment already states for its REST path).
2. **Downstream consumers read it as a session total, not a tick:**
   - `resolveDarkPool()` (`spx-desk.ts`) is WS-FIRST — it returns `darkPoolStore.data` directly
     whenever the WS store is fresh, ahead of the Redis-bridge cache, the in-process cache, and
     the REST aggregate fallback.
   - `uw-ws-cache-bridge.ts`'s `seedUwCacheFromWsStores` seeds the `dark_pool:SPX` Redis key from
     `darkPoolStore.data`, and `shouldSkipUwCacheRefreshTask("dark_pool_ticker", "SPX")` **skips
     the REST refresh entirely** while the WS channel reports fresh — so once WS starts
     delivering, the cache is permanently the understated single-frame value; REST never
     corrects it.
   - `src/app/api/market/spx/pulse/stream/route.ts` streams `darkPoolStore.data` straight into the
     live SSE pulse payload members receive.
   - `uw-lit-dark-ratio.ts`'s `computeLitDarkRatio` sums `dark_premium` from this same
     single-frame value while `lit_premium` is summed over `litTradesStore`'s **120-row
     accumulating ring** — an apples-to-oranges comparison that skews `lit_share` toward "all lit"
     regardless of actual dark-pool activity, because the dark side of the ratio was never really
     accumulated in the first place.

### Evidence (RED → GREEN)

New test file `src/lib/ws/uw-socket-darkpool-accum.test.ts`, 5 cases. The decisive one:

> `"THE BUG: re-normalizing only the LATEST frame silently loses an earlier SPX print's premium
> from the session total — accumulating first and re-normalizing fixes it"`

- **RED** (pre-fix, `mergeDarkPoolAccumRows` does not exist yet): all 5 new tests fail with
  `mergeDarkPoolAccumRows is not a function` — confirmed by stashing the `uw-socket.ts` change and
  re-running against the unmodified file.
- **GREEN** (post-fix): normalizing frame 2 alone (the pre-fix behavior) reports
  `total_premium: 3_000_000` — the $5M from frame 1 is gone. Accumulating frame 1 then frame 2 via
  the new `mergeDarkPoolAccumRows` and re-normalizing the full accumulated set reports
  `total_premium: 8_000_000` after frame 1, correctly staying at the sum after frame 2 — both
  prints present, `afterFrame2.prints.length >= 2`.
- Also covers: dedup of an identical retried row, cap-with-oldest-dropped-first behavior, and the
  empty-frame no-op case.
- Ran the full `uw-socket*`/`uw-lit-dark-ratio`/`unusual-whales` test files together (75 tests) —
  all pass, no regressions. `npx tsc --noEmit` clean. `npx eslint` clean on both touched files.

### Fix rationale

Added a session-long accumulator (`spxDarkPoolAccumRows`, capped at 2000 rows, dedup via the SAME
`darkPoolRawDedupKey` the existing market-wide `darkPoolRecentRing` already uses — same pattern,
not a new one) and a pure, exported reducer `mergeDarkPoolAccumRows` for it. The handler now: (1)
keeps the exact same gating as before — `normalizeDarkPoolWsPayload(payload, "SPX")` on the raw
frame still decides whether this frame carried a genuine, today-dated SPX print, so
`recordUwDelivery`/channel-freshness semantics are unchanged; (2) on that gate passing, merges this
frame's raw SPX-ticker rows into the accumulator and re-normalizes `darkPoolStore.data` from the
**full accumulated set**, not just the current frame. `normalizeDarkPoolWsPayload`'s own
today-ET + premium>0 filters still apply on every recompute, so a day rollover or a malformed row
still can't leak a stale/invalid print into the running total — the accumulator holds raw rows,
the filtering stays exactly where it already was.

Deliberately did **not** touch `src/lib/providers/unusual-whales.ts`'s REST dark-pool functions or
their test file (both under a separate open PR), and did not touch `spx-desk.ts`/other
`src/features/spx/*`/`src/lib/spx*` files — the root cause and the fix are both fully contained to
the WS ingest handler in `uw-socket.ts`; every downstream consumer listed above benefits
automatically without needing its own change, because they all just read `darkPoolStore.data`.
