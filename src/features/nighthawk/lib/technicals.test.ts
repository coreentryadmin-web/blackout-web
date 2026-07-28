import assert from "node:assert/strict";
import { test } from "node:test";
import { classifySetup } from "./technicals";

// Audit 2026-07-28 (P1): classifySetup() used to fall back to the sentinel string
// ["no dominant pattern"] when no setup condition matched. That sentinel is an internal
// diagnostic label, not member-facing copy — but buildDeterministicThesis() in
// deterministic-edition.ts joins setup_tags directly into the thesis prose with no
// special-casing, so the raw string leaked into what members read (e.g. "NVDA showing
// no dominant pattern in mixed trend"). The fix is to return an empty array instead;
// callers already fall through cleanly to trend-only or generic-setup prose when
// setup_tags is empty.

test("classifySetup: returns an empty array (not a sentinel string) when nothing matches", () => {
  const tags = classifySetup({
    price: 100,
    ema20: null,
    ema50: null,
    ema200: null,
    rsi14: null,
    atr14: null,
    relVol: null,
    priorHigh: null,
    priorClose: null,
    weekHigh: null,
    weekLow: null,
    rangeHigh20: null,
  });
  assert.deepEqual(tags, []);
  assert.ok(!tags.includes("no dominant pattern"));
});

test("classifySetup: still tags a real setup (RSI overbought) when a condition matches", () => {
  const tags = classifySetup({
    price: 100,
    ema20: null,
    ema50: null,
    ema200: null,
    rsi14: 75,
    atr14: null,
    relVol: null,
    priorHigh: null,
    priorClose: null,
    weekHigh: null,
    weekLow: null,
    rangeHigh20: null,
  });
  assert.deepEqual(tags, ["RSI overbought"]);
});
