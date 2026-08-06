// src/lib/zerodte/dual-lane-overlap.test.ts — cross-engine dual-admission regression (2026-08-06).
//
// WHY: the 0DTE/Day-Trade board's discovery ceiling (horizons.ts's ZERODTE_MAX_DTE) and Swing's
// commit-time sub-lane floor (swing/taxonomy.ts's SWING_SUB_LANES.TACTICAL.dteMin) are TWO SEPARATE
// hardcoded gates read by two independent engines — horizons.ts is display-only for Swing
// (serving-board.ts), never consulted by Swing's actual admission path. When the 0DTE ceiling
// widened 1→4 without the Swing floor moving in lockstep, a dte 2-4 contract would have been
// simultaneously admissible to BOTH the 0DTE board (deriveContractHorizon → ONE_DTE) AND Swing's
// TACTICAL lane (subLaneForDte) — the same contract double-counted as two different plays, each
// with its own gate stack, sizing, and grading. This test sweeps every calendar DTE in [0,90] and
// asserts the two engines' admission windows never overlap, so this class of bug fails CI the
// moment either constant drifts again — caught by adversarial review before this ever shipped.

import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveContractHorizon, isSameDayHorizon } from "./board";
import { subLaneForDte } from "../swing/taxonomy";
import { HORIZONS, ZERODTE_MAX_DTE } from "../horizons";

test("no calendar DTE in [0,90] is admissible to BOTH the 0DTE/Day-Trade board AND Swing's sub-lanes", () => {
  for (let dte = 0; dte <= 90; dte++) {
    const zeroDteAdmits = isSameDayHorizon(deriveContractHorizon(dte));
    const swingAdmits = subLaneForDte(dte) != null;
    assert.ok(
      !(zeroDteAdmits && swingAdmits),
      `dte ${dte} is admissible to BOTH the 0DTE board and a Swing sub-lane — dual-admission bug`,
    );
  }
});

test("the two engines' admission windows are the exact complementary halves of [0,30], with no gap", () => {
  // 0DTE/Day-Trade admits [0, ZERODTE_MAX_DTE]; Swing admits [HORIZONS.SWING.dteMin, 30]. Together
  // they must cover every DTE in [0,30] with zero gap and zero overlap.
  for (let dte = 0; dte <= 30; dte++) {
    const zeroDteAdmits = isSameDayHorizon(deriveContractHorizon(dte));
    const swingAdmits = subLaneForDte(dte) != null;
    assert.equal(
      zeroDteAdmits || swingAdmits,
      true,
      `dte ${dte} is admitted by NEITHER engine — a gap in [0,30] coverage`,
    );
  }
  assert.equal(HORIZONS.SWING.dteMin, ZERODTE_MAX_DTE + 1, "Swing's floor is exactly one past the 0DTE ceiling");
});
