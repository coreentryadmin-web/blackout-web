import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  uwTickerFromOptionsRoot,
  isUwStockStateUnsupportedIndex,
  resolveSpotFromUwStockState,
} from "./spot-fallback.ts";

test("uwTickerFromOptionsRoot maps I:SPX → SPX and passes equities through", () => {
  assert.equal(uwTickerFromOptionsRoot("I:SPX"), "SPX");
  assert.equal(uwTickerFromOptionsRoot("SPY"), "SPY");
});

// Regression guard for a real live bug (2026-08-28): UW's /stock-state endpoint returns HTTP 422
// for every index ticker — confirmed live against production UW: SPX, VIX, NDX, and RUT all 422,
// while SPY (a real ETF, not an index) returns 200. resolveSpotFromUwStockState is called
// explicitly with index option roots (e.g. I:SPX from socket-cluster-health.ts) as a fallback for
// when Polygon's indices feed is down, so this fallback could never actually work for the exact
// ticker it exists to protect while still burning a network round-trip and polluting UW's
// error-rate metrics on every attempt — measured live: 13/31 UW calls errored in one 5-minute
// window, entirely this call for SPX.
test("recognizes every index root UW's stock-state rejects", () => {
  assert.ok(isUwStockStateUnsupportedIndex("I:SPX"));
  assert.ok(isUwStockStateUnsupportedIndex("I:VIX"));
  assert.ok(isUwStockStateUnsupportedIndex("I:NDX"));
  assert.ok(isUwStockStateUnsupportedIndex("I:RUT"));
});

test("does not flag a real equity/ETF root", () => {
  assert.ok(!isUwStockStateUnsupportedIndex("SPY"));
  assert.ok(!isUwStockStateUnsupportedIndex("I:SPY"));
  assert.ok(!isUwStockStateUnsupportedIndex("AAPL"));
});

test("resolveSpotFromUwStockState short-circuits to null for an index root without a network call", async () => {
  const result = await resolveSpotFromUwStockState("I:SPX", Date.now());
  assert.equal(result, null);
});

test("resolveSpotFromUwStockState source: missing prev_close must not fabricate change_pct 0", () => {
  const src = readFileSync(join(process.cwd(), "src/lib/providers/spot-fallback.ts"), "utf8");
  assert.match(
    src,
    /const change_pct[\s\S]*?:\s*null/,
    "missing prev_close must yield null change_pct, not fabricated zero"
  );
  assert.doesNotMatch(
    src,
    /prev > 0 \?[\s\S]*?:\s*0;/,
    "must not fall back to fabricated 0% when prev_close is absent"
  );
  assert.match(src, /change_pct: number \| null/, "SpotQuote change_pct must allow null");
});
