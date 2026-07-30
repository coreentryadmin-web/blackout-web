import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  classifyPinTemporalStability,
  pinInputFromGexHistorySnapshot,
  pinTemporalStabilityEnabled,
} from "./pin-temporal-stability";
import { evaluatePinRegime } from "./pin-source";

describe("pin-temporal-stability", () => {
  test("pinTemporalStabilityEnabled defaults off", () => {
    const prev = process.env.PIN_TEMPORAL_STABILITY;
    delete process.env.PIN_TEMPORAL_STABILITY;
    assert.equal(pinTemporalStabilityEnabled(), false);
    process.env.PIN_TEMPORAL_STABILITY = "1";
    assert.equal(pinTemporalStabilityEnabled(), true);
    if (prev === undefined) delete process.env.PIN_TEMPORAL_STABILITY;
    else process.env.PIN_TEMPORAL_STABILITY = prev;
  });

  test("classifyPinTemporalStability — stable when ≥2 snaps same dir + tight walls", () => {
    const regime = evaluatePinRegime({
      spot: 596,
      callWall: 610,
      putWall: 590,
      callWallPct: 9,
      putWallPct: 9,
      gammaPosture: "long",
    })!;
    assert.ok(regime);
    const out = classifyPinTemporalStability({
      passes: [
        { regime, callWall: 610, putWall: 590 },
        { regime, callWall: 610.5, putWall: 590.2 },
      ],
    });
    assert.equal(out.cohort, "stable");
  });

  test("classifyPinTemporalStability — single when only one pass", () => {
    const regime = evaluatePinRegime({
      spot: 596,
      callWall: 610,
      putWall: 590,
      callWallPct: 9,
      putWallPct: 9,
      gammaPosture: "long",
    })!;
    const out = classifyPinTemporalStability({ passes: [{ regime, callWall: 610, putWall: 590 }] });
    assert.equal(out.cohort, "single");
  });

  test("pinInputFromGexHistorySnapshot derives walls from strike_totals", () => {
    const input = pinInputFromGexHistorySnapshot({
      ts: Date.now(),
      spot: 600,
      flip: 598,
      strike_totals: {
        "590": -5e8,
        "595": -8e8,
        "600": 1e8,
        "605": 3e8,
        "610": 9e8,
      },
    });
    assert.ok(input);
    assert.ok(input.callWall != null && input.putWall != null);
    assert.equal(input.gammaPosture, "long");
  });
});
