import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isRegimeStyleOppose,
  isWallPathVeto,
  isWallPathSupport,
  convictionBandFor,
  classifyCondorCortexRow,
  CONVICTION_A_MIN_SCORE,
  CONVICTION_B_MIN_SCORE,
  GEX_WALLS_OPPOSE_PRESENCE_MIN_WEIGHT,
} from "./cortex-condor-oppose-eval.mjs";

const regimeOpposeItem = (weight = 0.58) => ({
  source: "gex-walls",
  stance: "opposes",
  weight,
  halfLifeSec: 900,
  asOf: "2026-09-10T15:00:00Z",
  detail: "momentum-style long in a long-gamma tape (spot 6800 above flip 6750) — mean-reversion regime opposes trend-following entries.",
});

const wallPathVetoItem = () => ({
  source: "gex-walls",
  stance: "veto",
  weight: 1,
  halfLifeSec: 900,
  asOf: "2026-09-10T15:00:00Z",
  detail: "long target path crosses dominant call wall 6820 (14.2% of ladder gamma) 20 pts above spot 6800, inside 0.5x expected move (30 pts).",
});

const wallPathSupportItem = (weight = 0.8) => ({
  source: "gex-walls",
  stance: "supports",
  weight,
  halfLifeSec: 900,
  asOf: "2026-09-10T15:00:00Z",
  detail: "entry sits off same-side put wall 6780 (10.1% of ladder gamma) 15 pts below spot 6800, within 0.25x expected move (15 pts).",
});

const neutralFillerItem = () => ({
  source: "gex-walls",
  stance: "supports",
  weight: 0,
  halfLifeSec: 900,
  asOf: "2026-09-10T15:00:00Z",
  detail: "no dominant wall inside 0.5x expected move of the long path; regime style compatible.",
});

test("isRegimeStyleOppose matches ONLY the regime-mismatch detail text, not other gex-walls opposes", () => {
  assert.equal(isRegimeStyleOppose(regimeOpposeItem()), true);
  assert.equal(isRegimeStyleOppose(wallPathVetoItem()), false, "a veto is not an oppose stance");
  assert.equal(isRegimeStyleOppose({ ...regimeOpposeItem(), source: "flow-quality" }), false, "wrong source");
  assert.equal(isRegimeStyleOppose({ ...regimeOpposeItem(), detail: "something else entirely" }), false);
  assert.equal(isRegimeStyleOppose(null), false);
  assert.equal(isRegimeStyleOppose(undefined), false);
});

test("isWallPathVeto / isWallPathSupport distinguish the wallPathCheck items from the regime oppose and the neutral filler", () => {
  assert.equal(isWallPathVeto(wallPathVetoItem()), true);
  assert.equal(isWallPathVeto(regimeOpposeItem()), false);
  assert.equal(isWallPathSupport(wallPathSupportItem()), true);
  assert.equal(isWallPathSupport(neutralFillerItem()), false, "the zero-weight filler must not read as a real support");
  assert.equal(isWallPathSupport(regimeOpposeItem()), false, "an oppose stance is never a support");
});

test("convictionBandFor mirrors compose.ts's own A/B/C floors", () => {
  assert.equal(convictionBandFor(CONVICTION_A_MIN_SCORE), "A");
  assert.equal(convictionBandFor(CONVICTION_A_MIN_SCORE + 0.01), "A");
  assert.equal(convictionBandFor(CONVICTION_A_MIN_SCORE - 0.01), "B");
  assert.equal(convictionBandFor(CONVICTION_B_MIN_SCORE), "B");
  assert.equal(convictionBandFor(CONVICTION_B_MIN_SCORE - 0.01), "C");
  assert.equal(convictionBandFor(0), "C");
});

test("classifyCondorCortexRow: null for an abstained or missing cortex blob (never fabricates a classification)", () => {
  assert.equal(classifyCondorCortexRow(null), null);
  assert.equal(classifyCondorCortexRow(undefined), null);
  assert.equal(classifyCondorCortexRow({ abstained: true, reason: "x" }), null);
});

test("classifyCondorCortexRow: a real regime-oppose that DOES suppress the conviction band", () => {
  // score 1.7 (B) with the regime oppose active; without it, 1.7+0.58=2.28 -> A. A real,
  // material suppression this tool exists to surface.
  const row = classifyCondorCortexRow({
    decision: "PASS",
    score: 1.7,
    conviction: "B",
    opposes: [regimeOpposeItem(0.58)],
    supports: [],
    vetoes: [],
  });
  assert.ok(row);
  assert.equal(row.has_regime_oppose, true);
  assert.equal(row.regime_oppose_weight, 0.58);
  assert.equal(row.regime_oppose_material, true, "0.58 clears the 0.2 presence floor");
  assert.equal(row.score, 1.7);
  assert.equal(row.score_without_regime_oppose, 2.28);
  assert.equal(row.conviction_band, "B");
  assert.equal(row.counterfactual_band_without_regime_oppose, "A");
  assert.equal(row.band_suppressed_by_regime_oppose, true);
});

test("classifyCondorCortexRow: a regime-oppose present but NOT material (below the presence floor) and NOT band-suppressing", () => {
  const row = classifyCondorCortexRow({
    decision: "PASS",
    score: 3.0,
    conviction: "A",
    opposes: [regimeOpposeItem(0.1)],
    supports: [],
    vetoes: [],
  });
  assert.ok(row);
  assert.equal(row.regime_oppose_material, false, "0.1 is below the 0.2 presence floor");
  assert.equal(row.band_suppressed_by_regime_oppose, false, "already comfortably in A either way");
});

test("classifyCondorCortexRow: no regime oppose at all — clean row, counterfactual equals actual", () => {
  const row = classifyCondorCortexRow({
    decision: "PASS",
    score: 2.5,
    conviction: "A",
    opposes: [],
    supports: [wallPathSupportItem()],
    vetoes: [],
  });
  assert.ok(row);
  assert.equal(row.has_regime_oppose, false);
  assert.equal(row.regime_oppose_weight, null);
  assert.equal(row.score_without_regime_oppose, 2.5, "no oppose to remove -> counterfactual == actual");
  assert.equal(row.band_suppressed_by_regime_oppose, false);
  assert.equal(row.has_wall_path_support, true);
  assert.equal(row.wall_path_support_weight, 0.8);
});

test("classifyCondorCortexRow: a gex-walls VETO on a committed row is flagged as a real anomaly (should never happen — a veto blocks commit)", () => {
  const row = classifyCondorCortexRow({
    decision: "PASS",
    score: 4.0,
    conviction: "A",
    opposes: [],
    supports: [],
    vetoes: [wallPathVetoItem()],
  });
  assert.ok(row);
  assert.equal(row.has_wall_path_veto, true, "this row committed anyway -- worth flagging as an anomaly for a human to look at, not silently dropped");
});

test("GEX_WALLS_OPPOSE_PRESENCE_MIN_WEIGHT stays in lockstep with cortex-gate.ts:98 (value-pin)", () => {
  // A pure value pin, not an import (this .mjs mirrors the real constant per its own file
  // header) -- if the real constant ever changes, this test's failure is the trigger to update
  // BOTH this file and the mirror comment citing it.
  assert.equal(GEX_WALLS_OPPOSE_PRESENCE_MIN_WEIGHT, 0.2);
});
