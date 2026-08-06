import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatReturnPct,
  playQualityPct,
  primaryReturnLabel,
  primaryReturnPct,
  tierStarCount,
  tierStars,
  useHeroPlayCard,
  useLifecyclePlayCard,
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

  it("useHeroPlayCard is always false — detail lives on the right rail", () => {
    assert.equal(useHeroPlayCard(base, true, 1), false);
    assert.equal(useHeroPlayCard(base, false, 1), false);
    assert.equal(useHeroPlayCard({ ...base, horizon: "LEGACY" }, true, 1), false);
  });

  it("useLifecyclePlayCard enables lifecycle layout on all lanes", () => {
    assert.equal(useLifecyclePlayCard(base), true);
    assert.equal(useLifecyclePlayCard({ ...base, horizon: "SWING" }), true);
    assert.equal(useLifecyclePlayCard({ ...base, horizon: "LEGACY" }), true);
  });

  it("primaryReturnPct prefers trackPct on WATCH rows", () => {
    assert.equal(
      primaryReturnPct({ ...base, status: "WATCH", trackPct: 12, pnlPct: null }),
      12,
    );
    assert.equal(primaryReturnLabel({ ...base, status: "WATCH", trackPct: 12 }), "Since flag");
  });

  it("primaryReturnPct prefers trackPct on SKIP (FAILED pill) WATCH-tab rows", () => {
    assert.equal(
      primaryReturnPct({ ...base, status: "SKIP", trackPct: -3, pnlPct: null }),
      -3,
    );
    assert.equal(primaryReturnLabel({ ...base, status: "SKIP", trackPct: -3 }), "Since flag");
  });
});
