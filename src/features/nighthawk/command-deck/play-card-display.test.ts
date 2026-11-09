import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatReturnPct,
  playEntryDisplay,
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

  it("playEntryDisplay formats a real entry premium as compact $ — never fabricates one", () => {
    assert.equal(playEntryDisplay({ ...base, entry: 3.15 }), "$3.15");
    assert.equal(playEntryDisplay({ ...base, entry: 0.5 }), "$0.50");
    assert.equal(playEntryDisplay({ ...base, entry: null }), null);
    assert.equal(playEntryDisplay(base), null);
  });

  it("formatReturnPct signs positive returns", () => {
    assert.equal(formatReturnPct(87), "+87%");
    assert.equal(formatReturnPct(-12), "-12%");
  });

  // BUG: plain `Math.round(n)` on the SIGNED value ties toward +Infinity
  // (`Math.round(-2.5) === -2` but `Math.round(2.5) === 3`), so a losing Peak/Trough/P&L
  // reading sitting exactly on a half-percent tie renders a SMALLER magnitude than the
  // identical-distance gain. Same bug class already fixed in fmt-money.ts's fmtPct,
  // round-floats.ts, thermal/gex-heatmap/shift-math.ts, and this very command-deck's own
  // PlayTerminal.tsx/ZeroDteCommandPanel.tsx signPct helpers — formatReturnPct
  // (play-card-display.ts) is an independent, un-migrated instance of the same formatter.
  it("formatReturnPct: a tie above zero and the mirror tie below zero round to the SAME magnitude", () => {
    assert.equal(formatReturnPct(2.5), "+3%", "positive tie rounds away from zero");
    // RED before the fix: plain Math.round(-2.5) === -2 gives "-2%" (a SMALLER magnitude
    // than the mirrored "+3%"), not the symmetric "-3%".
    assert.equal(formatReturnPct(-2.5), "-3%", "mirror-image tie must round to the same magnitude");
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

  it("primaryReturnPct prefers trackPct on SKIP (PASSED pill) WATCH-tab rows", () => {
    assert.equal(
      primaryReturnPct({ ...base, status: "SKIP", trackPct: -3, pnlPct: null }),
      -3,
    );
    assert.equal(primaryReturnLabel({ ...base, status: "SKIP", trackPct: -3 }), "Since flag");
  });
});
