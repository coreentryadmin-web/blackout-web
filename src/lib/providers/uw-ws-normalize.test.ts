import { test } from "node:test";
import assert from "node:assert/strict";
import {
  aggregateGexStrikeExpiryToLadder,
  aggregateOptionTradesToStrikeRows,
  normalizeDarkPoolWsPayload,
  normalizeGexStrikeExpiryWsPayload,
  normalizeLitTradesWsPayload,
  normalizeOptionTradesWsPayload,
} from "./unusual-whales";
import { todayEt } from "../et-date";

test("normalizeOptionTradesWsPayload maps UW option_trades rows", () => {
  const rows = normalizeOptionTradesWsPayload({
    underlying_symbol: "SPX",
    option_symbol: "SPXW250630C06000000",
    price: 12.5,
    size: 10,
    executed_at: "2026-06-30T15:04:00Z",
    tags: ["sweep"],
    id: "abc123",
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.underlying, "SPX");
  assert.equal(rows[0]?.premium, 12500);
  assert.deepEqual(rows[0]?.tags, ["sweep"]);
});

test("normalizeOptionTradesWsPayload drops rows without executed_at", () => {
  assert.equal(
    normalizeOptionTradesWsPayload({ underlying_symbol: "SPY", price: 1, size: 1 }).length,
    0
  );
});

test("normalizeLitTradesWsPayload maps lit equity prints", () => {
  const rows = normalizeLitTradesWsPayload({
    symbol: "SPY",
    price: 600.12,
    size: 500,
    executed_at: "2026-06-30T15:04:00Z",
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.symbol, "SPY");
  assert.equal(rows[0]?.premium, 600.12 * 500);
});

// BUG FIX (sibling-propagation): `normalizeOptionTradesWsPayload` above was fixed to stop
// slicing `executed_at` to 19 chars (it strips a trailing "Z" and reinterprets a Z-bearing ISO
// string as LOCAL time once re-parsed) — this sibling parses the identical `executed_at ??
// timestamp` shape off the same UW WS transport and still had the defect. Before the fix,
// `rows[0].executed_at` was `"2026-06-30T15:04:00"` (no "Z") and `new Date(...)` on that value
// parsed as local time, not UTC — a different wall-clock instant on any non-UTC host.
test("normalizeLitTradesWsPayload keeps executed_at VERBATIM — does not strip the UTC 'Z'", () => {
  const rows = normalizeLitTradesWsPayload({
    symbol: "SPY",
    price: 600.12,
    size: 500,
    executed_at: "2026-06-30T15:04:00Z",
  });
  assert.equal(rows[0]?.executed_at, "2026-06-30T15:04:00Z");
  assert.equal(Date.parse(rows[0]!.executed_at), Date.parse("2026-06-30T15:04:00Z"));
});

// Same defect, sub-second precision: slicing to 19 chars drops BOTH the fractional seconds
// AND the trailing "Z" at once, for any timestamp UW sends with microsecond precision (the
// real shape `flow-timestamp-epoch.test.ts` captured live for the sibling `created_at` field:
// `"2026-08-21T20:14:37.211537Z"`).
test("normalizeLitTradesWsPayload keeps sub-second precision and the 'Z' on a long ISO timestamp", () => {
  const precise = "2026-08-21T20:14:37.211537Z";
  const rows = normalizeLitTradesWsPayload({
    symbol: "SPY",
    price: 600.12,
    size: 500,
    executed_at: precise,
  });
  assert.equal(rows[0]?.executed_at, precise);
});

// BUG FIX (sibling-propagation gap, 3rd sibling): `normalizeOptionTradesWsPayload` and
// `normalizeLitTradesWsPayload` above were both fixed to stop slicing `executed_at` to 19 chars
// (it strips a trailing "Z" and reinterprets a Z-bearing ISO string as LOCAL time once
// re-parsed) — `normalizeDarkPoolWsPayload` parses the identical `executed_at ?? date ??
// timestamp` shape off the same UW WS transport (`off_lit_trades`, the dark-pool sibling of
// `lit_trades`/`option_trades`) and still had the defect, unfixed by either prior PR. Before the
// fix, a microsecond-precision UW timestamp like `"<today>T20:14:37.211537Z"` was truncated to
// `"<today>T20:14:37"` (no "Z", no fractional seconds) — every downstream reader that re-parses
// `DarkPoolPrint.executed_at` with `new Date()`/`Date.parse()` (uw-lit-dark-ratio.ts's
// `latestPrintAgeMs`, discord-eod-recap.ts, helix-coord-window.ts, helix-flow-deep-link.ts) then
// reads a different wall-clock instant on any non-UTC host, and always loses sub-second
// precision. The test uses "today" in ET (not a fixed date) because the function's own
// same-session-day filter (`execDate !== today`) would otherwise drop the row before the
// truncation bug is even reached.
test("normalizeDarkPoolWsPayload keeps executed_at VERBATIM — does not strip the UTC 'Z' or sub-second precision", () => {
  const nowIso = new Date().toISOString(); // "<today>T20:14:37.211Z"
  const precise = nowIso.replace(/\.\d{3}Z$/, ".211537Z"); // simulate UW's real microsecond shape
  const rows = normalizeDarkPoolWsPayload({
    symbol: "SPY",
    executed_at: precise,
    premium: 1_250_000,
  });
  assert.equal(rows?.prints.length, 1);
  assert.equal(rows?.prints[0]?.executed_at, precise);
  assert.equal(Date.parse(rows!.prints[0]!.executed_at), Date.parse(precise));
});

// BUG FIX: `off_lit_trades` is a MARKET-WIDE UW WS channel (joined with no `:TICKER` suffix —
// see `joinWiresForChannel` in uw-socket.ts, which has a per-channel ticker-scoping branch for
// every OTHER channel but none for `off_lit_trades`), yet `normalizeDarkPoolWsPayload` had no
// ticker filter and its one real caller (the `off_lit_trades` subscribe handler) stamped
// whatever it returned onto the "SPX" cache key (`UW_KEYS.darkPoolTicker("SPX")` via
// `uw-ws-cache-bridge.ts`). A single WS frame carrying a non-SPX print (AAPL, in this test)
// alongside a real SPX print got silently blended into the "SPX" snapshot's total_premium/bias,
// and a frame with ONLY non-SPX prints silently overwrote the SPX slot with another ticker's
// tape entirely. The optional `onlyTicker` param scopes the snapshot to the real caller's
// ticker, while staying unfiltered (default) for every other caller — incl. the precision test
// above, which deliberately uses a non-SPX `symbol`.
test("normalizeDarkPoolWsPayload scopes to onlyTicker — a market-wide WS frame does not blend another ticker's prints into the SPX snapshot", () => {
  const today = todayEt();
  const mixed = [
    { ticker: "AAPL", executed_at: `${today}T15:04:00Z`, premium: 5_000_000, type: "call" },
    { ticker: "SPX", executed_at: `${today}T15:05:00Z`, premium: 1_000_000, type: "put" },
  ];

  // Unfiltered (no onlyTicker) still aggregates BOTH tickers — pre-existing, documented behavior
  // for any direct caller that wants the whole market-wide tape (e.g. dark_pool_recent).
  const unfiltered = normalizeDarkPoolWsPayload(mixed);
  assert.equal(unfiltered?.prints.length, 2);
  assert.equal(unfiltered?.total_premium, 6_000_000);

  // Scoped to "SPX" (what the off_lit_trades handler now passes) must see ONLY the real SPX
  // print — the AAPL print's $5M must never reach the snapshot cached under the SPX key.
  const scoped = normalizeDarkPoolWsPayload(mixed, "SPX");
  assert.equal(scoped?.prints.length, 1);
  assert.equal(scoped?.prints[0]?.ticker, "SPX");
  assert.equal(scoped?.total_premium, 1_000_000);

  // A frame carrying ONLY a non-SPX ticker must return null (never overwrite the SPX cache key
  // with another ticker's tape) rather than silently aggregating it under "SPX".
  const onlyOther = normalizeDarkPoolWsPayload(
    [{ ticker: "TSLA", executed_at: `${today}T15:06:00Z`, premium: 2_000_000 }],
    "SPX"
  );
  assert.equal(onlyOther, null);
});

test("aggregateOptionTradesToStrikeRows buckets call/put premium by strike", () => {
  const rows = aggregateOptionTradesToStrikeRows(
    [
      {
        id: "1",
        underlying: "SPX",
        option_symbol: "SPXW260630C06000000",
        price: 12,
        size: 10,
        premium: 12000,
        executed_at: "2026-06-30T15:04:00Z",
        tags: [],
      },
      {
        id: "2",
        underlying: "SPX",
        option_symbol: "SPXW260630P05900000",
        price: 8,
        size: 5,
        premium: 4000,
        executed_at: "2026-06-30T15:05:00Z",
        tags: [],
      },
    ],
    "SPX"
  );
  assert.equal(rows.length, 2);
  const callRow = rows.find((r) => Number(r.strike) === 6000);
  assert.equal(callRow?.call_premium, 12000);
  const putRow = rows.find((r) => Number(r.strike) === 5900);
  assert.equal(putRow?.put_premium, 4000);
});

test("normalizeGexStrikeExpiryWsPayload maps per-strike/expiry GEX rows", () => {
  const rows = normalizeGexStrikeExpiryWsPayload({
    ticker: "SPX",
    strike: 6000,
    expiry: "2026-06-30",
    call_gamma_oi: 1_000_000,
    put_gamma_oi: -500_000,
    price: 5998.5,
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.ticker, "SPX");
  assert.equal(rows[0]?.net_gex, 500_000);
});

test("aggregateGexStrikeExpiryToLadder sums net GEX across expiries per strike", () => {
  const ladder = aggregateGexStrikeExpiryToLadder(
    [
      {
        ticker: "SPX",
        strike: 6000,
        expiry: "2026-06-30",
        call_gamma_oi: 1_000_000,
        put_gamma_oi: 0,
        net_gex: 1_000_000,
        price: null,
      },
      {
        ticker: "SPX",
        strike: 6000,
        expiry: "2026-07-04",
        call_gamma_oi: 200_000,
        put_gamma_oi: -100_000,
        net_gex: 100_000,
        price: null,
      },
    ],
    "SPX"
  );
  assert.equal(ladder.get(6000), 1_100_000);
});
