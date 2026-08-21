import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { contextualFollowupsFromAnswer } from "./contextual-followups";

describe("contextualFollowupsFromAnswer", () => {
  it("builds strike-specific flow question from call wall", () => {
    const chips = contextualFollowupsFromAnswer({
      ticker: "AAPL",
      envelope: {
        levels: [{ label: "Call wall", price: 215 }],
      } as never,
    });
    assert.ok(chips.some((c) => /215 call wall/i.test(c)));
  });

  it("builds flip break question", () => {
    const chips = contextualFollowupsFromAnswer({
      ticker: "SPY",
      envelope: {
        levels: [{ label: "Gamma flip", price: 709.55 }],
      } as never,
    });
    assert.ok(chips.some((c) => /709\.55 flip/i.test(c)));
  });

  it("builds peer compare follow-up", () => {
    const chips = contextualFollowupsFromAnswer({
      compareCard: {
        kind: "peer_tickers",
        rows: [{ ticker: "NVDA" }, { ticker: "AMD" }],
      } as never,
    });
    assert.ok(chips.some((c) => /NVDA vs AMD/i.test(c)));
  });
});
