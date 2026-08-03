import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatReturnPct,
  playQualityPct,
  tierStarCount,
  tierStars,
  useHeroPlayCard,
} from "./play-card-display.ts";
import type { TerminalPlay } from "./types.ts";

const base: TerminalPlay = {
  id: "0DTE:NVDA",
  ticker: "NVDA",
  direction: "LONG",
  contract: "180C · 0DTE",
  score: 96,
  status: "CLOSED",
  horizon: "ZERO_DTE",
  exitModel: "RATCHET",
  factors: [],
  gates: [],
  recommendation: "HOLD",
  tierLabel: "A+",
  peak: 87,
};

describe("play-card-display", () => {
  it("playQualityPct prefers confidence then score", () => {
    assert.equal(playQualityPct(base), 96);
    assert.equal(playQualityPct({ ...base, confidence: 0.88, score: 50 }), 88);
  });

  it("tierStars maps A+ to five filled stars", () => {
    assert.equal(tierStarCount("A+"), 5);
    assert.match(tierStars("A+"), /^★{5}$/);
  });

  it("formatReturnPct signs positive returns", () => {
    assert.equal(formatReturnPct(87), "+87%");
    assert.equal(formatReturnPct(-12), "-12%");
  });

  it("useHeroPlayCard is true for selected 0DTE only", () => {
    assert.equal(useHeroPlayCard(base, true, 1), true);
    assert.equal(useHeroPlayCard(base, false, 1), false);
    assert.equal(useHeroPlayCard({ ...base, horizon: "LEGACY" }, true, 1), false);
  });
});
