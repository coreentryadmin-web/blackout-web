import { test } from "node:test";
import assert from "node:assert/strict";
import { spotFromLastTradeResult, SWING_UNDERLYING_TRADE_STALE_MS } from "./underlying-spot-freshness";

const NOW = 1_800_000_000_000; // arbitrary fixed epoch ms

function tradeAt(p: number, ageMs: number): Record<string, unknown> {
  const tMs = NOW - ageMs;
  return { p, t: tMs * 1e6 }; // Polygon's `t` is nanoseconds
}

test("spotFromLastTradeResult: fresh trade returns the price", () => {
  const trade = tradeAt(229.47, 5_000); // 5s old
  assert.equal(spotFromLastTradeResult(trade, NOW), 229.47);
});

test("spotFromLastTradeResult: trade exactly at the stale bound is NOT stale (strict >=/< boundary)", () => {
  const trade = tradeAt(100, SWING_UNDERLYING_TRADE_STALE_MS - 1);
  assert.equal(spotFromLastTradeResult(trade, NOW), 100);
});

test("spotFromLastTradeResult: a stale-but-200-OK trade (degraded feed) returns null, not the stale price", () => {
  // This is the Q38 scenario: Polygon keeps returning 200 with a real, finite, positive price —
  // just one that is hours old — and the old check (`p > 0`) would have trusted it as live.
  const trade = tradeAt(100, SWING_UNDERLYING_TRADE_STALE_MS + 60_000);
  assert.equal(spotFromLastTradeResult(trade, NOW), null);
});

test("spotFromLastTradeResult: a trade several hours stale is null", () => {
  const trade = tradeAt(100, 6 * 60 * 60_000);
  assert.equal(spotFromLastTradeResult(trade, NOW), null);
});

test("spotFromLastTradeResult: null/non-object trade is null", () => {
  assert.equal(spotFromLastTradeResult(null, NOW), null);
  assert.equal(spotFromLastTradeResult(undefined, NOW), null);
  assert.equal(spotFromLastTradeResult("nope", NOW), null);
});

test("spotFromLastTradeResult: missing or non-finite price is null even with a fresh timestamp", () => {
  assert.equal(spotFromLastTradeResult({ t: NOW * 1e6 }, NOW), null);
  assert.equal(spotFromLastTradeResult({ p: 0, t: NOW * 1e6 }, NOW), null);
  assert.equal(spotFromLastTradeResult({ p: -5, t: NOW * 1e6 }, NOW), null);
  assert.equal(spotFromLastTradeResult({ p: NaN, t: NOW * 1e6 }, NOW), null);
});

test("spotFromLastTradeResult: missing or non-finite timestamp is null even with a valid price — an unrecognized shape must not be trusted", () => {
  assert.equal(spotFromLastTradeResult({ p: 100 }, NOW), null);
  assert.equal(spotFromLastTradeResult({ p: 100, t: 0 }, NOW), null);
  assert.equal(spotFromLastTradeResult({ p: 100, t: -1 }, NOW), null);
  assert.equal(spotFromLastTradeResult({ p: 100, t: "not-a-number" }, NOW), null);
});

test("spotFromLastTradeResult: a small future timestamp (ordinary clock skew) is still fresh", () => {
  const trade = tradeAt(100, -2_000); // 2s in the future
  assert.equal(spotFromLastTradeResult(trade, NOW), 100);
});

test("spotFromLastTradeResult: respects a custom staleMs override", () => {
  const trade = tradeAt(100, 10_000);
  assert.equal(spotFromLastTradeResult(trade, NOW, 5_000), null); // 10s old > 5s bound
  assert.equal(spotFromLastTradeResult(trade, NOW, 20_000), 100); // 10s old < 20s bound
});
