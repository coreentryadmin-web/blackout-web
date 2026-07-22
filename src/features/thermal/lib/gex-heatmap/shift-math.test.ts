import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { shiftPercentForStrike, wallStrengthShift } from "./shift-math";

describe("shiftPercentForStrike", () => {
  it("computes a positive percent when the value built", () => {
    // baseline 1_000_000 -> current 1_500_000 (delta +500_000): built +50%
    assert.equal(shiftPercentForStrike(1_500_000, 500_000), 50);
  });

  it("computes a NEGATIVE percent when the value melted, even from a negative baseline", () => {
    // baseline -1_000_000 -> current -1_500_000 (delta -500_000): melted further, -50%
    // (dividing by |baseline| keeps the sign tied to delta, not baseline's own sign)
    assert.equal(shiftPercentForStrike(-1_500_000, -500_000), -50);
  });

  it("computes a POSITIVE percent when a negative position built back toward zero", () => {
    // baseline -1_000_000 -> current -500_000 (delta +500_000): this "built" (less negative)
    // and should read +50%, not the confusing -50% a bare delta/baseline would give.
    assert.equal(shiftPercentForStrike(-500_000, 500_000), 50);
  });

  it("returns null when there is no delta", () => {
    assert.equal(shiftPercentForStrike(1_000_000, null), null);
    assert.equal(shiftPercentForStrike(1_000_000, undefined), null);
  });

  it("returns null (never Infinity/NaN) when the baseline is ~zero", () => {
    assert.equal(shiftPercentForStrike(500, 500), null); // baseline = 0
    assert.equal(shiftPercentForStrike(500.4, 500), null); // baseline = 0.4, floored out
  });

  it("returns null on non-finite inputs", () => {
    assert.equal(shiftPercentForStrike(NaN, 100), null);
    assert.equal(shiftPercentForStrike(100, Infinity), null);
  });
});

describe("wallStrengthShift (magnitude-based built/melted — side-agnostic)", () => {
  it("a CALL wall building reads built +50% (same as raw delta on the positive side)", () => {
    // baseline +1.0M -> current +1.5M: heavier, +50%
    assert.deepEqual(wallStrengthShift(1_500_000, 500_000), { pct: 50, built: true });
  });

  it("a PUT wall building (GEX going MORE negative) reads built +100% — NOT 'melted'", () => {
    // baseline -0.5M -> current -1.0M (delta -0.5M): the put wall GREW. Raw-delta convention would
    // mislabel this "melted -100%"; magnitude says built +100%.
    assert.deepEqual(wallStrengthShift(-1_000_000, -500_000), { pct: 100, built: true });
  });

  it("a PUT wall decaying toward zero reads MELTED -50% — NOT 'built'", () => {
    // baseline -1.0M -> current -0.5M (delta +0.5M): the put wall got LIGHTER. Raw-delta convention
    // (shiftPercentForStrike) calls this "+50% built"; magnitude correctly calls it melted -50%.
    assert.deepEqual(wallStrengthShift(-500_000, 500_000), { pct: -50, built: false });
  });

  it("a CALL wall decaying reads melted -50%", () => {
    // baseline +1.0M -> current +0.5M: lighter, -50%
    assert.deepEqual(wallStrengthShift(500_000, -500_000), { pct: -50, built: false });
  });

  it("verb and sign are ALWAYS consistent (built ⇔ pct ≥ 0) across sides", () => {
    for (const [cur, d] of [
      [1_500_000, 500_000],
      [-1_000_000, -500_000],
      [-500_000, 500_000],
      [500_000, -500_000],
    ] as const) {
      const r = wallStrengthShift(cur, d)!;
      assert.equal(r.built, r.pct >= 0, `built/sign mismatch for (${cur}, ${d})`);
    }
  });

  it("shares shiftPercentForStrike's guards: null on no-delta, ~zero baseline, non-finite", () => {
    assert.equal(wallStrengthShift(1_000_000, null), null);
    assert.equal(wallStrengthShift(1_000_000, undefined), null);
    assert.equal(wallStrengthShift(500, 500), null); // baseline 0
    assert.equal(wallStrengthShift(500.4, 500), null); // baseline 0.4 floored
    assert.equal(wallStrengthShift(NaN, 100), null);
    assert.equal(wallStrengthShift(100, Infinity), null);
  });
});
