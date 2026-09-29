import { test } from "node:test";
import assert from "node:assert/strict";
import {
  productionUnusualnessMultiplier,
  correctedUnusualnessRatio,
  correctedUnusualnessMultiplier,
  effectiveScore,
  productionFinalSort,
  correctedFinalSort,
} from "./signal-intelligence-corrections";

// ─── Bug 1: unusualness-multiplier unit mismatch ────────────────────────────────────────────

test("productionUnusualnessMultiplier reproduces the live bug: floors to 0.5x for realistic lane-points/dollars inputs", () => {
  // A real, plausible live shape: 28 lane points (LANE_MAX_FLOW, the max a candidate can score in
  // that lane), against a modest $500k baseline. 28 / 500_000 is ~0.000056 -- clamps to the 0.5 floor.
  const mult = productionUnusualnessMultiplier(28, 500_000);
  assert.equal(mult, 0.5);
});

test("productionUnusualnessMultiplier: even the theoretical maximum lane-point value against the smallest realistic baseline still floors to 0.5x", () => {
  // CANDIDATE_MIN_BASELINE_PREMIUM is the floor production applies to the baseline itself, so
  // even the most favorable case (max lane points, minimum baseline) never escapes the 0.5 floor --
  // this is the actual shape of the bug: the multiplier is a de facto CONSTANT 0.5x, not a 0.5-3x range.
  const mult = productionUnusualnessMultiplier(28, 75_000); // CANDIDATE_MIN_BASELINE_PREMIUM per candidates.ts
  assert.equal(mult, 0.5);
});

test("productionUnusualnessMultiplier: a zero/negative baseline reads as the floor, never divides by zero", () => {
  assert.equal(productionUnusualnessMultiplier(28, 0), 0.5);
  assert.equal(productionUnusualnessMultiplier(28, -100), 0.5);
});

test("correctedUnusualnessRatio: real dollars over real dollars, the same comparison extractCandidateTickers already does correctly", () => {
  // $2M raw flow premium against a $500k baseline -- genuinely 4x unusual, not near-zero.
  assert.equal(correctedUnusualnessRatio(2_000_000, 500_000), 4);
});

test("correctedUnusualnessRatio: zero/negative baseline is an honest 0, never a divide-by-zero or fabricated ratio", () => {
  assert.equal(correctedUnusualnessRatio(2_000_000, 0), 0);
  assert.equal(correctedUnusualnessRatio(2_000_000, -100), 0);
});

test("correctedUnusualnessMultiplier: clamps a genuinely low ratio to the 0.5 floor", () => {
  // $50k against a $500k baseline -- genuinely NOT unusual, correctly floors.
  assert.equal(correctedUnusualnessMultiplier(50_000, 500_000), 0.5);
});

test("correctedUnusualnessMultiplier: clamps a genuinely extreme ratio to the 3x ceiling", () => {
  // $10M against a $500k baseline -- a real 20x spike, correctly ceilings rather than compounding unbounded.
  assert.equal(correctedUnusualnessMultiplier(10_000_000, 500_000), 3);
});

test("correctedUnusualnessMultiplier: a genuinely moderate ratio produces a real value BETWEEN the floor and ceiling", () => {
  // This is the exact thing the bug prevents today: production's multiplier is a de facto
  // constant 0.5, so it can never land here. $1M against a $500k baseline = 2x, correctly mid-range.
  const mult = correctedUnusualnessMultiplier(1_000_000, 500_000);
  assert.equal(mult, 2);
  assert.ok(mult > 0.5 && mult < 3, "must land strictly between the clamp bounds for a moderate ratio");
});

// ─── Bug 2: governor-blind final sort ───────────────────────────────────────────────────────

test("effectiveScore mirrors deterministic-edition.ts:901's own formula: score - (govPenalty ?? 0)", () => {
  assert.equal(effectiveScore({ score: 80, govPenalty: 20 }), 60);
  assert.equal(effectiveScore({ score: 80, govPenalty: null }), 80);
  assert.equal(effectiveScore({ score: 80, govPenalty: undefined }), 80);
  assert.equal(effectiveScore({ score: 80 }), 80);
});

test("effectiveScore: a null/undefined score reads as -Infinity, matching edition-builder.ts's existing null-safety on the raw sort", () => {
  assert.equal(effectiveScore({ score: null, govPenalty: 20 }), -Infinity);
  assert.equal(effectiveScore({ score: undefined, govPenalty: 20 }), -Infinity);
});

// The concrete, real-world shape of the bug: a governor-demoted candidate can outrank one that
// legitimately should sort higher, because the final sort ignores the penalty entirely.
const GOVERNOR_DEMOTED_SCENARIO = [
  { ticker: "TSLA", score: 80, govPenalty: 20 }, // demoted for a loss-streak halt -- effective 60
  { ticker: "NVDA", score: 70, govPenalty: 0 },  // clean -- effective 70
  { ticker: "AMD", score: 55, govPenalty: 0 },   // clean -- effective 55
];

test("productionFinalSort reproduces the live bug: the governor-demoted candidate is re-promoted to rank #1", () => {
  const result = productionFinalSort(GOVERNOR_DEMOTED_SCENARIO);
  assert.deepEqual(
    result.map((r) => r.ticker),
    ["TSLA", "NVDA", "AMD"],
    "raw-score order puts the governor-demoted TSLA (80) ahead of the clean NVDA (70) -- the exact bug"
  );
  assert.equal(result.find((r) => r.ticker === "TSLA")?.rank, 1);
});

test("correctedFinalSort fixes the ordering: the governor-demoted candidate correctly sorts below the clean one it should trail", () => {
  const result = correctedFinalSort(GOVERNOR_DEMOTED_SCENARIO);
  assert.deepEqual(
    result.map((r) => r.ticker),
    ["NVDA", "TSLA", "AMD"],
    "effective-score order: NVDA (70) > TSLA (60 after penalty) > AMD (55)"
  );
  assert.equal(result.find((r) => r.ticker === "NVDA")?.rank, 1);
  assert.equal(result.find((r) => r.ticker === "TSLA")?.rank, 2);
});

test("productionFinalSort and correctedFinalSort both stamp 1-based rank in sorted order", () => {
  const result = correctedFinalSort(GOVERNOR_DEMOTED_SCENARIO);
  assert.deepEqual(result.map((r) => r.rank), [1, 2, 3]);
});

test("productionFinalSort and correctedFinalSort never mutate the input array or its elements", () => {
  const input = GOVERNOR_DEMOTED_SCENARIO.map((c) => ({ ...c }));
  const inputSnapshot = input.map((c) => ({ ...c }));
  productionFinalSort(input);
  correctedFinalSort(input);
  assert.deepEqual(input, inputSnapshot, "neither sort may mutate the caller's array or its objects");
});

test("both sorts push a null/undefined-score candidate to the very last rank", () => {
  const withMissingScore = [
    { ticker: "AMD", score: 55, govPenalty: 0 },
    { ticker: "GHOST", score: null, govPenalty: 0 },
    { ticker: "NVDA", score: 70, govPenalty: 0 },
  ];
  assert.equal(productionFinalSort(withMissingScore).at(-1)?.ticker, "GHOST");
  assert.equal(correctedFinalSort(withMissingScore).at(-1)?.ticker, "GHOST");
});

test("when no candidate carries a govPenalty, corrected and production sorts agree exactly", () => {
  const clean = [
    { ticker: "NVDA", score: 90, govPenalty: 0 },
    { ticker: "AMD", score: 70, govPenalty: null },
    { ticker: "TSLA", score: 50 },
  ];
  assert.deepEqual(
    productionFinalSort(clean).map((r) => r.ticker),
    correctedFinalSort(clean).map((r) => r.ticker),
    "with no governor penalties in play, both formulas reduce to the same raw-score order"
  );
});
