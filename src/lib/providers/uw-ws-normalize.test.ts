import { test } from "node:test";
import assert from "node:assert/strict";
import {
  aggregateGexStrikeExpiryToLadder,
  aggregateOptionTradesToStrikeRows,
  normalizeGexStrikeExpiryWsPayload,
  normalizeLitTradesWsPayload,
  normalizeOptionTradesWsPayload,
} from "./unusual-whales";

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
