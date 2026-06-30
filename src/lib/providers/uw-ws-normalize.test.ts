import { test } from "node:test";
import assert from "node:assert/strict";
import {
  aggregateOptionTradesToStrikeRows,
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
