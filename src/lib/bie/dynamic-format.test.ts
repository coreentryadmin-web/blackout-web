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

  // BUG FIX (2026-09-22, Ask Largo standing mandate — fresh angle: BIE/Helix product-read table
  // path). helix-read-intent.ts's own header documents that `option_type` is ALWAYS produced
  // uppercase ("CALL"/"PUT" — FlowAlert's type, and computeFlowStrikeStacks's normalization) and
  // that comparing it against a lowercase `"put"` literal is ALWAYS false, mislabeling every real
  // put as a call. That exact defect was fixed in helix-read.ts's PROSE line (via the new
  // `optionSideSuffix` helper) but the sibling TABLE renderer in this file
  // (`formatHelixPrintTable`, reached whenever a question matches `wantsHelixPrintList`, e.g. "top
  // 5 prints by premium") still used the raw, broken `p.option_type === "put" ? "p" : "c"` — so a
  // member asking for a print list in table form saw every PUT mislabeled "c" (call), independent
  // of size or direction.
  test("helix print-list TABLE renders real PUT prints as puts, not fabricated calls", () => {
    const route: BieRoute = { intent: "helix_read", tickers: ["NVDA"] };
    const out = applyDynamicFormat(route, "top 3 prints by premium on NVDA", {
      answer: "placeholder",
      context: {
        top: [
          { ticker: "NVDA", strike: 500, premium: 23_000_000, direction: "bearish", option_type: "PUT" },
          { ticker: "NVDA", strike: 510, premium: 12_000_000, direction: "bullish", option_type: "CALL" },
        ],
      },
    });
    assert.match(out.answer, /500p/i);
    assert.doesNotMatch(out.answer, /500c/i);
    assert.match(out.answer, /510c/i);
  });
});
