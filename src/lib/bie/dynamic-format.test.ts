import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { applyDynamicFormat } from "./dynamic-format";
import type { BieRoute } from "./router";

describe("applyDynamicFormat", () => {
  test("narrows king-node structure asks to a level line (not a desk dump)", () => {
    const route: BieRoute = { intent: "spx_structure", tickers: ["SPX"] };
    const out = applyDynamicFormat(route, "what's the king node on SPX right now", {
      answer: "Synthetic fallback",
      context: {
        narrow: "king_node",
        raw: { gex_king_strike: 7550, price: 7530 },
      },
    });
    assert.match(out.answer, /king|7550/i);
    assert.doesNotMatch(out.answer, /SPX Live Desk read/i);
  });

  test("exports applyDynamicFormat used by largo-stress-shape harness", () => {
    assert.equal(typeof applyDynamicFormat, "function");
  });
});
