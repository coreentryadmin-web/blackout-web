import { test } from "node:test";
import assert from "node:assert/strict";
import { uwTickerFromOptionsRoot } from "./spot-fallback";

test("uwTickerFromOptionsRoot maps I:SPX → SPX and passes equities through", () => {
  assert.equal(uwTickerFromOptionsRoot("I:SPX"), "SPX");
  assert.equal(uwTickerFromOptionsRoot("SPY"), "SPY");
});
