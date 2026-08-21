import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalCdf,
  impliedProbBeyond,
  reactionStats,
  evidenceLean,
  buildMeridianSummary,
} from "./meridian-summary-core";

/* ── normalCdf ────────────────────────────────────────────────────────────────────── */

test("normalCdf: known values", () => {
  assert.ok(Math.abs(normalCdf(0) - 0.5) < 1e-6);
  assert.ok(Math.abs(normalCdf(1) - 0.8413447) < 1e-5);
  assert.ok(Math.abs(normalCdf(-1) - 0.1586553) < 1e-5);
  assert.ok(Math.abs(normalCdf(1.96) - 0.975) < 1e-3);
});

test("normalCdf: symmetric about zero", () => {
  for (const z of [0.3, 1.1, 2.4]) {
    assert.ok(Math.abs(normalCdf(z) + normalCdf(-z) - 1) < 1e-6, `not symmetric at ${z}`);
  }
});

/* ── impliedProbBeyond ────────────────────────────────────────────────────────────── */

test("impliedProbBeyond: at exactly one implied move, the probability is a tail", () => {
  // 1σ above spot must be well under half and nowhere near certain.
  const p = impliedProbBeyond(100, 108, 8, "above")!;
  assert.ok(p > 0.1 && p < 0.35, `expected a tail, got ${p}`);
});

test("impliedProbBeyond: above + below at the same level sum to 1", () => {
  const a = impliedProbBeyond(100, 105, 8, "above")!;
  const b = impliedProbBeyond(100, 105, 8, "below")!;
  assert.ok(Math.abs(a + b - 1) < 1e-6);
});

test("impliedProbBeyond: a level further away is always less likely", () => {
  const near = impliedProbBeyond(100, 104, 8, "above")!;
  const far = impliedProbBeyond(100, 112, 8, "above")!;
  assert.ok(far < near, "a more distant level must not be more probable");
});

test("impliedProbBeyond: no free bullish drift at the money", () => {
  // The lognormal median adjustment must leave P(above spot) just UNDER 0.5 — a lognormal's
  // median sits below its mean. Asserting merely "near 0.5" would pass with the term missing
  // (it gives exactly 0.5), which is the version of this test that proves nothing.
  const p = impliedProbBeyond(100, 100, 8, "above")!;
  assert.ok(p < 0.5, `at-the-money must not be >= 50% (drift-free), got ${p}`);
  assert.ok(p > 0.45, `but only slightly under, got ${p}`);
});

test("impliedProbBeyond: a wider implied move pushes a fixed level toward 50%", () => {
  const tight = impliedProbBeyond(100, 110, 4, "above")!;
  const wide = impliedProbBeyond(100, 110, 20, "above")!;
  assert.ok(wide > tight, "more uncertainty must make a distant level more reachable");
});

test("impliedProbBeyond: returns null rather than guessing on bad input", () => {
  assert.equal(impliedProbBeyond(null, 100, 8, "above"), null);
  assert.equal(impliedProbBeyond(100, null, 8, "above"), null);
  assert.equal(impliedProbBeyond(100, 110, null, "above"), null);
  assert.equal(impliedProbBeyond(100, 110, 0, "above"), null, "a zero move has no distribution");
  assert.equal(impliedProbBeyond(0, 110, 8, "above"), null);
  assert.equal(impliedProbBeyond(100, 110, -5, "above"), null);
});

/* ── reactionStats ────────────────────────────────────────────────────────────────── */

test("reactionStats: counts direction and reports the sample", () => {
  const s = reactionStats([
    { session_change_pct: 4 },
    { session_change_pct: -2 },
    { session_change_pct: 6 },
    { session_change_pct: 1 },
  ]);
  assert.equal(s.sample, 4);
  assert.equal(s.up, 3);
  assert.equal(s.down, 1);
  assert.equal(s.upRate, 0.75);
});

test("reactionStats: no rate below the minimum sample — 2 prints is not a probability", () => {
  const s = reactionStats([{ session_change_pct: 5 }, { session_change_pct: 3 }]);
  assert.equal(s.sample, 2);
  assert.equal(s.upRate, null, "a rate from 2 prints must not be published");
  assert.ok(s.medianAbsMovePct != null, "the moves themselves are still reportable");
});

test("reactionStats: median, not mean — one gap must not define 'typical'", () => {
  const s = reactionStats([
    { session_change_pct: 1 },
    { session_change_pct: 2 },
    { session_change_pct: 3 },
    { session_change_pct: 40 },
  ]);
  assert.equal(s.medianAbsMovePct, 2.5);
  assert.equal(s.maxAbsMovePct, 40, "the tail is still reported, just not as typical");
});

test("reactionStats: falls back to next-day only when the anchored session is absent", () => {
  const s = reactionStats([
    { session_change_pct: 5, next_day_change_pct: -99 },
    { session_change_pct: null, next_day_change_pct: -3 },
  ]);
  assert.equal(s.up, 1);
  assert.equal(s.down, 1);
});

test("reactionStats: nulls and an empty list are handled without inventing zeros", () => {
  for (const input of [null, undefined, [], [{ session_change_pct: null }]]) {
    const s = reactionStats(input as never);
    assert.equal(s.sample, 0);
    assert.equal(s.upRate, null);
    assert.equal(s.medianAbsMovePct, null);
  }
});

/* ── evidenceLean ─────────────────────────────────────────────────────────────────── */

test("evidenceLean: weights the tally, and neutral pillars do not vote", () => {
  const e = evidenceLean([
    { label: "Flow", lean: "bullish", weight: 4 },
    { label: "Thermal", lean: "bearish", weight: 1 },
    { label: "News", lean: "neutral", weight: 9 },
  ]);
  assert.equal(e.bullWeight, 4);
  assert.equal(e.bearWeight, 1);
  assert.equal(e.voting, 2, "a neutral pillar has not taken a side");
  assert.ok(e.net > 0.5);
});

test("evidenceLean: a one-sided book is NOT contested however small", () => {
  const e = evidenceLean([{ label: "Flow", lean: "bullish", weight: 1 }]);
  assert.equal(e.contested, false);
});

test("evidenceLean: contested needs real weight on BOTH sides", () => {
  const split = evidenceLean([
    { label: "Flow", lean: "bullish", weight: 3 },
    { label: "Thermal", lean: "bearish", weight: 3 },
  ]);
  assert.equal(split.contested, true);

  const lopsided = evidenceLean([
    { label: "Flow", lean: "bullish", weight: 10 },
    { label: "Thermal", lean: "bearish", weight: 1 },
  ]);
  assert.equal(lopsided.contested, false, "a token dissent must not veto a heavy read");
});

test("evidenceLean: an empty book leans nowhere", () => {
  const e = evidenceLean([]);
  assert.equal(e.net, 0);
  assert.equal(e.voting, 0);
  assert.equal(e.contested, false);
});

/* ── buildMeridianSummary ─────────────────────────────────────────────────────────── */

const base = {
  spot: 100,
  movePct: 8,
  moveSource: "chain_iv",
  band: { up: 108, down: 92 },
  thermal: { call_wall: 110, put_wall: 90, max_pain: 100, flip: 98 },
  prints: [
    { session_change_pct: 5 },
    { session_change_pct: -3 },
    { session_change_pct: 7 },
    { session_change_pct: 2 },
  ],
  signals: [
    { label: "Flow", lean: "bullish", weight: 4 },
    { label: "Thermal", lean: "bullish", weight: 2 },
    { label: "Street", lean: "bearish", weight: 1 },
  ],
};

test("summary: produces BOTH a call and a put idea", () => {
  const s = buildMeridianSummary(base);
  assert.ok(s.call && s.put, "both sides must always be offered");
  assert.equal(s.call!.side, "call");
  assert.equal(s.put!.side, "put");
});

test("summary: a wall on the wrong side of spot is not used as that side's target", () => {
  // A call wall BELOW spot is already breached; quoting it would produce a near-certain
  // probability for a play with no room left.
  const s = buildMeridianSummary({ ...base, thermal: { call_wall: 90, put_wall: 80 } });
  assert.notEqual(s.call!.levelFrom, "call wall");
  assert.equal(s.call!.level, 108, "falls through to the implied-move edge");
});

test("summary: probabilities are never invented when the move is unknown", () => {
  const s = buildMeridianSummary({ ...base, movePct: null, band: null });
  assert.equal(s.call?.impliedProb ?? null, null);
  assert.equal(s.put?.impliedProb ?? null, null);
});

test("summary: a contested book is reported as contested and leans neutral", () => {
  const s = buildMeridianSummary({
    ...base,
    signals: [
      { label: "Flow", lean: "bullish", weight: 3 },
      { label: "Thermal", lean: "bearish", weight: 3 },
    ],
  });
  assert.equal(s.contested, true);
  assert.equal(s.lean, "neutral");
  assert.match(s.headline, /split/i);
  assert.ok(s.call && s.put, "a split book still shows both ideas");
});

test("summary: an empty book says so instead of manufacturing a direction", () => {
  const s = buildMeridianSummary({ ...base, signals: [] });
  assert.equal(s.lean, "neutral");
  assert.match(s.headline, /no pillar/i);
});

test("summary: 'inputs' distinguishes an absent feed from a neutral one", () => {
  const s = buildMeridianSummary({ spot: 100, movePct: null, prints: [], signals: [] });
  assert.equal(s.inputs.move, false);
  assert.equal(s.inputs.history, false);
  assert.equal(s.inputs.thermal, false);
  assert.equal(s.inputs.flow, false);
});

test("summary: confidence stays inside 0-100 across degenerate inputs", () => {
  const cases = [
    base,
    { ...base, signals: [{ label: "X", lean: "bearish", weight: 99 }] },
    { ...base, prints: [] },
    { ...base, movePct: 200 },
  ];
  for (const c of cases) {
    const s = buildMeridianSummary(c as never);
    for (const idea of [s.call, s.put]) {
      if (!idea) continue;
      assert.ok(idea.confidence >= 0 && idea.confidence <= 100, `confidence out of range: ${idea.confidence}`);
    }
  }
});

test("summary: every 'why' line is non-empty and the level is sourced", () => {
  const s = buildMeridianSummary(base);
  for (const idea of [s.call!, s.put!]) {
    assert.ok(idea.why.length > 0);
    for (const line of idea.why) assert.ok(line.trim().length > 0);
    assert.ok(idea.levelFrom.trim().length > 0, "a level with no stated source is unusable");
  }
});

test("summary: the call's invalidation sits below spot and the put's above", () => {
  const s = buildMeridianSummary(base);
  assert.ok(s.call!.invalidation! < base.spot);
  assert.ok(s.put!.invalidation! > base.spot);
});

test("summary: a too-small print sample suppresses the rate but explains itself", () => {
  const s = buildMeridianSummary({ ...base, prints: [{ session_change_pct: 4 }] });
  assert.equal(s.call!.historicalRate, null);
  assert.equal(s.call!.historicalSample, 1);
  assert.ok(s.call!.why.some((w) => /too few/i.test(w)), "an absent number must say why");
});

test("summary: levels are sorted high to low so they read as a price ladder", () => {
  const s = buildMeridianSummary(base);
  const vals = s.levels.map((l) => l.value);
  assert.deepEqual(vals, [...vals].sort((a, b) => b - a));
});

/* ── regressions found by running the real payloads, not the fixtures ────────────────
 * Both of these passed every fixture test and failed on live data. They are kept in the
 * shape they arrived in, spot values and all.
 */

test("summary: a wall sitting ON spot is not a target — BHP, wall 90.00 vs spot 89.99", () => {
  const s = buildMeridianSummary({
    spot: 89.99,
    movePct: 5,
    band: { up: 94.49, down: 85.49 },
    thermal: { call_wall: 90, put_wall: 77.5 },
    prints: [],
    signals: [{ label: "Flow", lean: "bullish", weight: 2 }],
  });
  assert.notEqual(s.call!.levelFrom, "call wall", '"get above 90" from 89.99 is not an idea');
  assert.equal(s.call!.level, 94.49, "falls through to the implied-move edge");
});

test("summary: a wall beyond reach on this event is not a target either — BHP put wall at 2.8σ", () => {
  const s = buildMeridianSummary({
    spot: 89.99,
    movePct: 5,
    band: { up: 94.49, down: 85.49 },
    thermal: { call_wall: 110, put_wall: 77.5 },
    prints: [],
    signals: [{ label: "Flow", lean: "bearish", weight: 2 }],
  });
  assert.notEqual(s.put!.levelFrom, "put wall", "a level the event cannot reach prices at 0%");
  assert.equal(s.put!.level, 85.49);
  assert.ok(s.put!.impliedProb! > 0.05, "and the resulting probability is meaningful again");
});

test("summary: inverted walls cannot put a stop on the wrong side of spot — TGT, call 150 < put 152.5", () => {
  // Served live: call_wall BELOW put_wall on a 151.01 spot. A PUT invalidated at 150 would sit
  // UNDER the price it needs to fall from.
  const s = buildMeridianSummary({
    spot: 151.01,
    movePct: 8.5,
    band: { up: 163.85, down: 138.17 },
    thermal: { call_wall: 150, put_wall: 152.5 },
    prints: [],
    signals: [{ label: "Flow", lean: "bullish", weight: 4 }],
  });
  assert.ok(s.put!.invalidation! > 151.01, `put stop must sit above spot, got ${s.put!.invalidation}`);
  assert.ok(s.call!.invalidation! < 151.01, `call stop must sit below spot, got ${s.call!.invalidation}`);
});

test("summary: with no walls at all, both stops still land on the right side of spot", () => {
  const s = buildMeridianSummary({
    spot: 100,
    movePct: 6,
    band: { up: 106, down: 94 },
    thermal: null,
    prints: [],
    signals: [{ label: "Flow", lean: "bullish", weight: 1 }],
  });
  assert.equal(s.call!.invalidation, 94);
  assert.equal(s.put!.invalidation, 106);
});
