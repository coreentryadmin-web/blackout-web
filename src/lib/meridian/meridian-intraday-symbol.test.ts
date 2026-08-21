import { test } from "node:test";
import assert from "node:assert/strict";

import { flowPriceSymbol } from "@/lib/providers/flow-price-symbol";

/**
 * Guards the index-namespace defect in meridian-intraday-reaction.ts.
 *
 * That module cannot be imported here — it begins `import "server-only"`, which resolves to a
 * throwing stub outside Next's react-server condition. So this pins the DERIVATION the module
 * now depends on instead of the module itself: if `flowPriceSymbol("SPX")` ever stops yielding
 * an `I:`-namespaced symbol, `spxCloseOnDate` and `macroIntradayReactions` silently return to
 * fetching an equity that does not exist, which is a 200 OK with zero results rather than an
 * error. The live probe behind this (2026-08-21, both Massive and Polygon):
 *
 *   /v2/aggs/ticker/SPX/range/1/day/2026-08-19/2026-08-19    -> 200 OK, resultsCount 0
 *   /v2/aggs/ticker/I:SPX/range/1/day/2026-08-19/2026-08-19  -> 200 OK, close 7707.98
 */
test("SPX resolves to the Polygon INDEX namespace, never the bare equity root", () => {
  const resolved = flowPriceSymbol("SPX");
  assert.equal(resolved?.isIndex, true, "SPX must take the index path");
  assert.equal(resolved?.symbol, "I:SPX");
  assert.notEqual(
    resolved?.symbol,
    "SPX",
    "the bare root returns a silent empty 200 from the equity namespace"
  );
});

test("the other index roots Meridian's intraday path accepts also resolve", () => {
  // meridian-intraday-reaction previously gated on /^(SPX|VIX|NDX|RUT)$/ and then passed the
  // bare root through — so every symbol that regex admitted was equally broken.
  for (const [root, expected] of [
    ["SPX", "I:SPX"],
    ["VIX", "I:VIX"],
    ["NDX", "I:NDX"],
    ["RUT", "I:RUT"],
  ] as const) {
    const r = flowPriceSymbol(root);
    assert.equal(r?.isIndex, true, `${root} must take the index path`);
    assert.equal(r?.symbol, expected);
  }
});

test("an already-namespaced symbol passes through, and an equity is left alone", () => {
  assert.deepEqual(flowPriceSymbol("I:SPX"), { symbol: "I:SPX", isIndex: true });
  // An unknown root must NOT be guessed into an `I:` form — a missing price is recoverable,
  // a confidently wrong one is not.
  assert.deepEqual(flowPriceSymbol("NVDA"), { symbol: "NVDA", isIndex: false });
});
