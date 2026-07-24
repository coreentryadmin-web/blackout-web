import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SWING_PILLARS,
  SWING_PILLAR_WEIGHTS_BY_ARCHETYPE,
  SWING_PILLAR_BASE_WEIGHTS,
  SWING_PILLAR_WEIGHTS_GRADUATED,
  weightSum,
  weightsForArchetype,
} from "./swing-archetype.ts";
import { SWING_ARCHETYPES } from "./taxonomy.ts";
import {
  scoreSwingPillars,
  structureSignal,
  relStrengthSignal,
  flowSignal,
  volatilitySignal,
  type SwingPillarSignals,
} from "./swing-pillars.ts";

test("weights: every archetype vector + the base sum to exactly 100, and weights are ungraduated", () => {
  assert.equal(SWING_PILLAR_WEIGHTS_GRADUATED, false);
  assert.equal(weightSum(SWING_PILLAR_BASE_WEIGHTS), 100);
  for (const a of SWING_ARCHETYPES) {
    const w = SWING_PILLAR_WEIGHTS_BY_ARCHETYPE[a];
    assert.equal(weightSum(w), 100, `${a} weights must sum to 100`);
    // every pillar present in every vector
    for (const p of SWING_PILLARS) assert.ok(typeof w[p] === "number", `${a} missing ${p}`);
  }
});

test("scoreSwingPillars: all pillars at 1.0 → 100 for any archetype (weights span the whole score)", () => {
  const all: SwingPillarSignals = Object.fromEntries(SWING_PILLARS.map((p) => [p, 1]));
  for (const a of SWING_ARCHETYPES) {
    const r = scoreSwingPillars(all, a);
    assert.equal(r.score, 100, `${a} full signal → 100`);
    assert.equal(r.presentCount, 7);
  }
});

test("scoreSwingPillars: absent pillars DROP from the denominator (renormalize), never penalize", () => {
  // Only STRUCTURE present at 1.0 → renormalizes to 100 (not weight-fraction of 100).
  const r = scoreSwingPillars({ STRUCTURE: 1 }, "BREAKOUT");
  assert.equal(r.presentCount, 1);
  assert.equal(r.score, 100, "single present pillar at 1.0 renormalizes to 100");
  // null and omitted both count as absent.
  const r2 = scoreSwingPillars({ STRUCTURE: 1, FLOW: null }, "BREAKOUT");
  assert.equal(r2.presentCount, 1);
  assert.equal(r2.score, 100);
});

test("scoreSwingPillars: archetype swap RE-RANKS two names (flow-heavy vs structure-heavy)", () => {
  const flowName: SwingPillarSignals = { STRUCTURE: 0.3, FLOW: 1.0, REL_STRENGTH: 0.3, VOLATILITY: 0.3, CATALYST: 0.3, REGIME: 0.3, DATA_QUALITY: 1 };
  const structName: SwingPillarSignals = { STRUCTURE: 1.0, FLOW: 0.3, REL_STRENGTH: 1.0, VOLATILITY: 0.3, CATALYST: 0.3, REGIME: 0.3, DATA_QUALITY: 1 };
  // Under FLOW_ACCUMULATION (flow-weighted), the flow name should out-score the structure name...
  const flowArch_flowName = scoreSwingPillars(flowName, "FLOW_ACCUMULATION").score;
  const flowArch_structName = scoreSwingPillars(structName, "FLOW_ACCUMULATION").score;
  assert.ok(flowArch_flowName > flowArch_structName, "flow archetype rewards the flow-heavy name");
  // ...and under BREAKOUT (structure+relStr-weighted) the ranking flips.
  const breakout_flowName = scoreSwingPillars(flowName, "BREAKOUT").score;
  const breakout_structName = scoreSwingPillars(structName, "BREAKOUT").score;
  assert.ok(breakout_structName > breakout_flowName, "breakout archetype rewards the structure-heavy name");
});

test("scoreSwingPillars: score clamped [0,100]; no present pillar → 0, not NaN", () => {
  const r = scoreSwingPillars({}, "BREAKOUT");
  assert.equal(r.score, 0);
  assert.equal(r.presentCount, 0);
  assert.match(r.reason, /unscorable/);
  const over = scoreSwingPillars({ STRUCTURE: 5 }, "BREAKOUT"); // out-of-range raw clamps to 1
  assert.equal(over.score, 100);
});

test("weightsForArchetype: null archetype → the base vector", () => {
  assert.deepEqual(weightsForArchetype(null), SWING_PILLAR_BASE_WEIGHTS);
  assert.deepEqual(weightsForArchetype("BREAKOUT"), SWING_PILLAR_WEIGHTS_BY_ARCHETYPE.BREAKOUT);
});

test("signal helpers: return null when the primary signal is absent, 0–1 when present", () => {
  assert.equal(structureSignal({}), null);
  assert.ok((structureSignal({ priceAboveEma20: true, ema20AboveEma50: true, ema50Rising: true }) ?? -1) === 1);
  assert.equal(relStrengthSignal({}), null);
  assert.ok((relStrengthSignal({ nameReturnPct: 12, spyReturnPct: 0 }) ?? -1) === 1); // +12% vs 0, band 6 → clamps to 1
  assert.equal(flowSignal({}), null);
  assert.ok((flowSignal({ accumAlignedDays: 4, accumTotalDays: 4 }) ?? -1) === 1);
  // theta burden erodes the vol read hardest on TACTICAL (thetaSensitivity 1.0).
  const tac = volatilitySignal({ contractQuality01: 1, thetaBurden01: 1 }, "TACTICAL");
  const ext = volatilitySignal({ contractQuality01: 1, thetaBurden01: 1 }, "EXTENDED");
  assert.ok(tac != null && ext != null && tac < ext, "tactical theta penalty is harsher than extended");
});
