import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildDiscoveryFunnelHint } from "./discovery-funnel-hint";

describe("discovery-funnel-hint", () => {
  it("surfaces top gate in summary", () => {
    const hint = buildDiscoveryFunnelHint({
      detected_tickers: 12,
      gate_blocked_events: 8,
      commit_events: 2,
      by_gate: [{ gate: "score_floor", label: "Score floor (G-3)", n: 5 }],
    });
    assert.equal(hint.top_gate, "score_floor");
    assert.match(hint.summary ?? "", /Score floor/);
  });

  it("returns null summary when no activity", () => {
    const hint = buildDiscoveryFunnelHint({
      detected_tickers: 0,
      gate_blocked_events: 0,
      commit_events: 0,
      by_gate: [],
    });
    assert.equal(hint.summary, null);
  });
});
