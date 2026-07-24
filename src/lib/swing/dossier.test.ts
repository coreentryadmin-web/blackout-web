import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSwingDossier, SWING_DOSSIER_VERSION, type SwingDossierInput } from "./dossier.ts";
import type { SwingReads } from "../swing-signals.ts";
import type { ZeroDteFlowAccumulation } from "../zerodte/flow-accumulation-context.ts";

function accum(direction: "bull" | "bear", days: number): ZeroDteFlowAccumulation {
  return {
    direction,
    strength: 80,
    days,
    net_signed_premium: direction === "bull" ? 5e6 : -5e6,
    magnet_strike: 100,
    magnet_side: direction === "bull" ? "call" : "put",
    aligned: true,
  };
}

const bullReads: SwingReads = {
  accumulation: accum("bull", 4),
  flowWindowDays: 5,
  returnPct10d: 8,
  spyReturnPct10d: 1,
  priceAboveEma20: true,
  ema20AboveEma50: true,
  ema50Rising: true,
};

// Modest reads: the reads-derived archetype signals (trend-stack / rel-strength / accumulation) stay low so
// the strong breakout EXTRAS win the classification. (Pillar inputs below are independent of reads.)
const modestReads: SwingReads = {
  accumulation: accum("bull", 1), // 1/5 window → accumPersistence ≈ 0.2
  flowWindowDays: 5,
  returnPct10d: 3, // (3−1)/6 ≈ 0.33 rel-strength
  spyReturnPct10d: 1,
  priceAboveEma20: true, // only one rung → trend-stack ≈ 0.33
};

// A fully-grounded dossier input: all 7 pillars present + a breakout archetype.
const fullInput: SwingDossierInput = {
  ticker: "NVDA",
  intendedDte: 14, // STANDARD
  asOf: "2026-07-24T14:00:00.000Z",
  reads: modestReads,
  archetypeExtras: { nearRangeExtreme01: 0.95, breakoutQuality01: 0.9, volumeExpansion01: 0.9 },
  structure: { priceAboveEma20: true, ema20AboveEma50: true, ema50Rising: true },
  relStrength: { nameReturnPct: 8, spyReturnPct: 1 },
  flow: { accumAlignedDays: 4, accumTotalDays: 5 },
  volatility: { contractQuality01: 0.7, thetaBurden01: 0.3 },
  catalyst: { catalystStrength01: 0.5 },
  regime01: 0.6,
  dataQuality01: 0.9,
};

test("buildSwingDossier: composes a complete carrier (version, sub-lane, archetype, score in range)", () => {
  const d = buildSwingDossier(fullInput);
  assert.equal(d.v, SWING_DOSSIER_VERSION);
  assert.equal(d.ticker, "NVDA");
  assert.equal(d.direction, "LONG");
  assert.equal(d.asOf, "2026-07-24T14:00:00.000Z");
  assert.equal(d.subLane, "STANDARD");
  assert.equal(d.archetype.archetype, "BREAKOUT");
  assert.ok(d.score.score >= 0 && d.score.score <= 100);
  assert.equal(d.dataQuality.degraded, false);
  assert.equal(d.dataQuality.presentPillars, 7);
  assert.deepEqual(d.dataQuality.missing, []);
});

test("buildSwingDossier: a null read stays null in pillarSignals AND is counted in dataQuality.missing (no 0)", () => {
  const d = buildSwingDossier({
    ...fullInput,
    flow: undefined, // FLOW cluster absent
    regime01: null, // REGIME feed missing
  });
  assert.equal(d.pillarSignals.FLOW, null, "absent FLOW stays null, never 0");
  assert.equal(d.pillarSignals.REGIME, null, "missing REGIME feed stays null");
  assert.ok(d.dataQuality.missing.includes("FLOW"));
  assert.ok(d.dataQuality.missing.includes("REGIME"));
  assert.equal(d.dataQuality.presentPillars, 5);
  assert.equal(d.dataQuality.degraded, false); // 5 pillars, STRUCTURE present → not degraded
});

test("buildSwingDossier: degraded when too few pillars present", () => {
  const d = buildSwingDossier({
    ticker: "ABC",
    intendedDte: 5,
    reads: bullReads,
    structure: { priceAboveEma20: true, ema20AboveEma50: true, ema50Rising: true },
    relStrength: { nameReturnPct: 8, spyReturnPct: 1 },
    // only 2 pillars grounded
  });
  assert.equal(d.dataQuality.presentPillars, 2);
  assert.equal(d.dataQuality.degraded, true);
  assert.equal(d.subLane, "TACTICAL");
});

test("buildSwingDossier: degraded when the critical STRUCTURE pillar is missing even if count is high", () => {
  const d = buildSwingDossier({
    ...fullInput,
    structure: undefined, // STRUCTURE absent
  });
  assert.equal(d.pillarSignals.STRUCTURE, null);
  assert.ok(d.dataQuality.missing.includes("STRUCTURE"));
  assert.equal(d.dataQuality.presentPillars, 6);
  assert.equal(d.dataQuality.degraded, true, "missing structural backbone degrades regardless of count");
});

test("buildSwingDossier: no intended DTE → sub-lane null; DTE outside [2,30] → null", () => {
  assert.equal(buildSwingDossier({ ...fullInput, intendedDte: null }).subLane, null);
  assert.equal(buildSwingDossier({ ...fullInput, intendedDte: 45 }).subLane, null);
});

test("buildSwingDossier: score partitions on the classified archetype (label feeds the weighting)", () => {
  const d = buildSwingDossier(fullInput);
  assert.equal(d.score.archetype, d.archetype.archetype);
  assert.equal(d.score.subLane, d.subLane);
});
