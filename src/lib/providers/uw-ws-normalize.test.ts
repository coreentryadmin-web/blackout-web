import { test } from "node:test";
import assert from "node:assert/strict";
import {
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
