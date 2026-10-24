import assert from "node:assert/strict";
import { test } from "node:test";
import {
  huntModeWeights,
  normalizeHuntFilters,
  meetsMinConviction,
  applyHuntScoreFilters,
  huntDteGuidance,
  type NormalizedHuntFilters,
} from "./hunt-mode.ts";
import type { ScoredCandidate } from "./scorer.ts";

// hunt-mode.ts and its only consumer (hunt-builder.ts) had zero test coverage anywhere in the
// repo before this file. The logic was hand-verified correct during a Night Hawk Legacy audit
// sweep (2026-09-14) -- this is a pure coverage addition, not a bug fix, so there is no RED
// phase: every assertion below locks in already-correct behavior.

test("huntModeWeights: day mode caps at 1 DTE (the fixed 0DTE-board bug -- was 5)", () => {
  const w = huntModeWeights("day");
  assert.equal(w.maxDte, 1);
  assert.equal(w.minLiquidity, 500_000);
});

test("huntModeWeights: swing and leap widen DTE and lower the liquidity floor", () => {
  const swing = huntModeWeights("swing");
  const leap = huntModeWeights("leap");
  assert.equal(swing.maxDte, 30);
  assert.equal(leap.maxDte, 90);
  assert.ok(swing.minLiquidity < 500_000);
  assert.ok(leap.minLiquidity < swing.minLiquidity);
});

test("normalizeHuntFilters: day mode populates max_dte/spx_context, never dte_min/dte_max/require_catalyst/max_entry_premium", () => {
  const f = normalizeHuntFilters("day", { max_dte: 1, spx_context: true });
  assert.equal(f.max_dte, 1);
  assert.equal(f.spx_context, true);
  assert.equal(f.dte_min, null);
  assert.equal(f.dte_max, null);
  assert.equal(f.require_catalyst, false);
  assert.equal(f.max_entry_premium, null);
});

test("normalizeHuntFilters: day mode max_dte out of [0,1] range is dropped, not clamped", () => {
  const f = normalizeHuntFilters("day", { max_dte: 5 });
  assert.equal(f.max_dte, null);
});

test("normalizeHuntFilters: swing mode defaults dte_min=2/dte_max=30 when unset, populates max_entry_premium, never max_dte/spx_context", () => {
  const f = normalizeHuntFilters("swing", {});
  assert.equal(f.dte_min, 2);
  assert.equal(f.dte_max, 30);
  assert.equal(f.max_dte, null);
  assert.equal(f.spx_context, false);
  assert.equal(f.require_catalyst, false);
});

test("normalizeHuntFilters: swing mode honors explicit dte_min/dte_max/max_entry_premium overrides", () => {
  const f = normalizeHuntFilters("swing", { dte_min: 5, dte_max: 15, max_entry_premium: 8 });
  assert.equal(f.dte_min, 5);
  assert.equal(f.dte_max, 15);
  assert.equal(f.max_entry_premium, 8);
});

test("normalizeHuntFilters: leap mode defaults dte_min=30/dte_max=90, require_catalyst defaults true", () => {
  const f = normalizeHuntFilters("leap", {});
  assert.equal(f.dte_min, 30);
  assert.equal(f.dte_max, 90);
  assert.equal(f.require_catalyst, true);
  assert.equal(f.max_entry_premium, null);
});

test("normalizeHuntFilters: leap require_catalyst can be turned off via boolean false or the string 'false'", () => {
  assert.equal(normalizeHuntFilters("leap", { require_catalyst: false }).require_catalyst, false);
  assert.equal(normalizeHuntFilters("leap", { require_catalyst: "false" }).require_catalyst, false);
});

test("normalizeHuntFilters: spx_context only ever applies to day mode", () => {
  assert.equal(normalizeHuntFilters("swing", { spx_context: true }).spx_context, false);
  assert.equal(normalizeHuntFilters("leap", { spx_context: true }).spx_context, false);
  assert.equal(normalizeHuntFilters("day", { spx_context: "false" }).spx_context, false);
});

test("normalizeHuntFilters: min_premium falls back to the mode's own liquidity floor when unset", () => {
  const f = normalizeHuntFilters("leap", {});
  assert.equal(f.min_premium, huntModeWeights("leap").minLiquidity);
});

test("normalizeHuntFilters: min_premium honors an explicit positive override", () => {
  const f = normalizeHuntFilters("day", { min_premium: 750_000 });
  assert.equal(f.min_premium, 750_000);
});

test("normalizeHuntFilters: direction only accepts bull/bear, anything else falls back to any", () => {
  assert.equal(normalizeHuntFilters("day", { direction: "bull" }).direction, "bull");
  assert.equal(normalizeHuntFilters("day", { direction: "BEAR" }).direction, "bear");
  assert.equal(normalizeHuntFilters("day", { direction: "sideways" }).direction, "any");
  assert.equal(normalizeHuntFilters("day", {}).direction, "any");
});

test("normalizeHuntFilters: watchlist splits on commas/whitespace and uppercases", () => {
  const f = normalizeHuntFilters("day", { watchlist: "aapl, msft  nvda" });
  assert.deepEqual(f.watchlist, ["AAPL", "MSFT", "NVDA"]);
});

test("normalizeHuntFilters: min_conviction of 'C' is not a recognized floor (C is the rank floor already)", () => {
  assert.equal(normalizeHuntFilters("day", { min_conviction: "C" }).min_conviction, null);
  assert.equal(normalizeHuntFilters("day", { min_conviction: "a+" }).min_conviction, "A+");
});

test("meetsMinConviction: ranks C < B < A < A+, unrecognized strings rank as C", () => {
  assert.equal(meetsMinConviction("A+", "A"), true);
  assert.equal(meetsMinConviction("B", "A"), false);
  assert.equal(meetsMinConviction("garbage", "B"), false);
  assert.equal(meetsMinConviction("garbage", "A+"), false);
});

function makeCandidate(overrides: Partial<ScoredCandidate> = {}): ScoredCandidate {
  return {
    ticker: "TEST",
    score: 50,
    direction: "long",
    flow_score: 0,
    tech_score: 0,
    pos_score: 0,
    news_score: 0,
    smart_money_score: 0,
    conviction: "B",
    ...overrides,
  } as ScoredCandidate;
}

test("applyHuntScoreFilters: filters by min_score, direction, and min_conviction independently", () => {
  const candidates = [
    makeCandidate({ ticker: "LOW", score: 10, direction: "long", conviction: "C" }),
    makeCandidate({ ticker: "HIGH_LONG", score: 80, direction: "long", conviction: "A" }),
    makeCandidate({ ticker: "HIGH_SHORT", score: 80, direction: "short", conviction: "A" }),
  ];
  const base: NormalizedHuntFilters = {
    sector: null,
    min_score: null,
    direction: "any",
    min_conviction: null,
    watchlist: [],
    min_streak: null,
    max_iv_rank: null,
    min_premium: null,
    max_dte: null,
    dte_min: null,
    dte_max: null,
    require_catalyst: false,
    max_entry_premium: null,
    spx_context: false,
  };

  const byScore = applyHuntScoreFilters(candidates, { ...base, min_score: 50 });
  assert.deepEqual(byScore.map((c) => c.ticker).sort(), ["HIGH_LONG", "HIGH_SHORT"]);

  const byDirection = applyHuntScoreFilters(candidates, { ...base, direction: "bull" });
  assert.deepEqual(byDirection.map((c) => c.ticker), ["LOW", "HIGH_LONG"]);

  const byConviction = applyHuntScoreFilters(candidates, { ...base, min_conviction: "A" });
  assert.deepEqual(byConviction.map((c) => c.ticker).sort(), ["HIGH_LONG", "HIGH_SHORT"]);

  const combined = applyHuntScoreFilters(candidates, {
    ...base,
    min_score: 50,
    direction: "bear",
    min_conviction: "A",
  });
  assert.deepEqual(combined.map((c) => c.ticker), ["HIGH_SHORT"]);
});

test("applyHuntScoreFilters: does not mutate the input array", () => {
  const candidates = [makeCandidate({ ticker: "A", score: 10 })];
  const base: NormalizedHuntFilters = {
    sector: null,
    min_score: 50,
    direction: "any",
    min_conviction: null,
    watchlist: [],
    min_streak: null,
    max_iv_rank: null,
    min_premium: null,
    max_dte: null,
    dte_min: null,
    dte_max: null,
    require_catalyst: false,
    max_entry_premium: null,
    spx_context: false,
  };
  const result = applyHuntScoreFilters(candidates, base);
  assert.equal(candidates.length, 1, "original array untouched");
  assert.equal(result.length, 0);
});

test("huntDteGuidance: returns mode-appropriate DTE guidance text", () => {
  assert.match(huntDteGuidance("day", 1), /0DTE to 1 DTE/);
  assert.match(huntDteGuidance("swing", 30), /2–30 DTE/);
  assert.match(huntDteGuidance("leap", 90), /DTE\+?/);
});
