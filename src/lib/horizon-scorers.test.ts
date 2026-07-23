import { test } from "node:test";
import assert from "node:assert/strict";
import {
  scoreZeroDte,
  scoreSwing,
  scoreLeaps,
  momentumFromReturnPct,
  accumulationPersistence,
  trendStackScore,
  trendDurabilityScore,
  relativeStrengthScore,
  liquidityDepthScore,
} from "./horizon-scorers.ts";

// ── normalizers ──────────────────────────────────────────────────────────────────

test("momentumFromReturnPct: saturates a big move at 1, floors a drop at 0", () => {
  assert.equal(momentumFromReturnPct(8), 1);
  assert.equal(momentumFromReturnPct(4), 0.5);
  assert.equal(momentumFromReturnPct(-3), 0);
  assert.equal(momentumFromReturnPct(null), 0);
});

test("accumulationPersistence: aligned-of-total fraction, safe on zero", () => {
  assert.equal(accumulationPersistence(3, 4), 0.75);
  assert.equal(accumulationPersistence(0, 0), 0);
  assert.equal(accumulationPersistence(5, 5), 1);
});

test("trendStackScore: each rung worth a third", () => {
  assert.equal(Math.round(trendStackScore({ priceAboveEma20: true, ema20AboveEma50: true, ema50Rising: true }) * 100), 100);
  assert.ok(Math.abs(trendStackScore({ priceAboveEma20: true }) - 1 / 3) < 1e-9);
  assert.equal(trendStackScore({}), 0);
});

test("trendDurabilityScore: above-200 is the dominant rung", () => {
  assert.equal(trendDurabilityScore({ priceAboveEma200: true }), 0.45);
  assert.equal(trendDurabilityScore({ priceAboveEma200: true, ema200Rising: true, higherLows: true }), 1);
  assert.equal(trendDurabilityScore({ ema200Rising: true, higherLows: true }), 0.55); // below 200 caps it
});

test("relativeStrengthScore: only OUTperformance counts, clamped both ends", () => {
  assert.equal(relativeStrengthScore(6, 0), 1);
  assert.equal(relativeStrengthScore(3, 0), 0.5);
  assert.equal(relativeStrengthScore(-2, 0), 0); // underperformance floors at 0
  assert.equal(relativeStrengthScore(null, 0), 0);
});

test("liquidityDepthScore: min of OI and volume reads (both required to exit weeks out)", () => {
  assert.equal(liquidityDepthScore(2000, 500), 1);
  assert.equal(liquidityDepthScore(2000, 0), 0); // deep OI but no flow → untradeable exit
  assert.equal(liquidityDepthScore(0, 500), 0);
});

// ── the three lenses are genuinely different ───────────────────────────────────────

test("scoreZeroDte: flow quality dominates; strong flow alone clears the 65 floor", () => {
  const strong = scoreZeroDte({ flowQuality: 90, gammaPull: 0.8, sweepUrgency: 0.7, intradayAlign: 0.9 });
  assert.ok(strong.score >= 65, `strong 0DTE should commit, got ${strong.score}`);
  // Flow quality is the biggest single lever: kill it and the play collapses even with everything else max.
  const noFlow = scoreZeroDte({ flowQuality: 0, gammaPull: 1, sweepUrgency: 1, intradayAlign: 1 });
  assert.equal(noFlow.components.flowQuality, 0);
  assert.ok(noFlow.score < strong.score);
  assert.ok(strong.components.flowQuality >= strong.components.gammaPull);
});

test("scoreSwing: momentum + accumulation lead; a persistent multi-day mover commits", () => {
  const s = scoreSwing({ momentum: 0.9, accumulation: 0.9, trendStack: 0.8, relStrength: 0.7 });
  assert.ok(s.score >= 60, `a strong swing should commit, got ${s.score}`);
  // The same name with hot momentum but ZERO cross-session accumulation is materially weaker —
  // that's the swing lens refusing to trust a one-print pop.
  const noAccum = scoreSwing({ momentum: 0.9, accumulation: 0, trendStack: 0.8, relStrength: 0.7 });
  assert.ok(noAccum.score < s.score);
  assert.equal(noAccum.components.accumulation, 0);
});

test("scoreLeaps: trend durability is the dominant rung; below the 200-day can't commit on flow alone", () => {
  const durable = scoreLeaps({ trendDurability: 1, relStrength: 0.9, liquidityDepth: 0.8, catalyst: 0.7 });
  assert.ok(durable.score >= 62, `a durable LEAPS should commit, got ${durable.score}`);
  // No durable trend (below 200-day, no higher lows) → even great RS + liquidity + catalyst stays under floor.
  const noTrend = scoreLeaps({ trendDurability: 0, relStrength: 1, liquidityDepth: 1, catalyst: 1 });
  assert.ok(noTrend.score < 62, `no trend must not commit LEAPS, got ${noTrend.score}`);
});

test("the three lenses rate the SAME raw inputs differently (distinct pick logic)", () => {
  // A hot-flow, no-trend, no-accumulation name: great 0DTE, poor Swing, poor LEAPS.
  const zd = scoreZeroDte({ flowQuality: 88, gammaPull: 0.7, sweepUrgency: 0.8, intradayAlign: 0.8 });
  const sw = scoreSwing({ momentum: 0.1, accumulation: 0.0, trendStack: 0.1, relStrength: 0.1 });
  const lp = scoreLeaps({ trendDurability: 0.0, relStrength: 0.1, liquidityDepth: 0.2, catalyst: 0.0 });
  assert.ok(zd.score > sw.score && zd.score > lp.score, "a same-day flow burst must rate 0DTE >> Swing/LEAPS");
  assert.equal(zd.horizon, "ZERO_DTE");
  assert.equal(sw.horizon, "SWING");
  assert.equal(lp.horizon, "LEAPS");
});

test("scores clamp to 0..100 and components sum to the score (rounding aside)", () => {
  for (const s of [
    scoreZeroDte({ flowQuality: 100, gammaPull: 1, sweepUrgency: 1, intradayAlign: 1 }),
    scoreSwing({ momentum: 1, accumulation: 1, trendStack: 1, relStrength: 1 }),
    scoreLeaps({ trendDurability: 1, relStrength: 1, liquidityDepth: 1, catalyst: 1 }),
  ]) {
    assert.ok(s.score >= 0 && s.score <= 100);
    const sum = Object.values(s.components).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(s.score - sum) <= 1, `${s.horizon}: score ${s.score} vs sum ${sum}`);
    assert.equal(s.score, 100); // all-max inputs → full marks
  }
});
