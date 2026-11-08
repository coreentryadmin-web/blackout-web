import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { shiftPercentForStrike, wallStrengthShift, fmtShiftPercentForStrike } from "./shift-math";

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

describe("fmtShiftPercentForStrike", () => {
  it("formats whole-percent shift labels with true minus sign", () => {
    assert.equal(fmtShiftPercentForStrike(1_500_000, 500_000), "+50%");
    assert.equal(fmtShiftPercentForStrike(-1_500_000, -500_000), "−50%");
    assert.equal(fmtShiftPercentForStrike(1_000_000, null), "—");
  });

  it("rounds to nearest whole percent like profile badges", () => {
    assert.equal(fmtShiftPercentForStrike(1_550_000, 550_000), "+55%");
    assert.equal(fmtShiftPercentForStrike(2_130_000, 1_130_000), "+113%");
  });

  // BUG THIS FIXES: plain `Math.round(pct)` ties toward +Infinity
  // (`Math.round(-2.5) === -2` but `Math.round(2.5) === 3`), so a melting strike sitting exactly
  // on a whole-percent tie rounded to a SMALLER magnitude than the identical-magnitude building
  // strike's mirror value — the same sign-biased rounding asymmetry already fixed in
  // `fmt-money.ts`'s `fmtPct` (2026-10-26) and `round-floats.ts`, just missed in this sibling
  // Thermal-desk formatter. Rounding `Math.abs(pct)` and reapplying `Math.sign(pct)` makes both
  // signs tie the same direction (away from zero), so equal-magnitude opposite shifts render as
  // equal-magnitude opposite labels.
  it("rounds ties by MAGNITUDE, then reapplies sign — equal-magnitude opposite shifts match", () => {
    // baseline 1,000,000 -> current 1,025,000 (delta +25,000): pct = +2.5, a real tie.
    assert.equal(fmtShiftPercentForStrike(1_025_000, 25_000), "+3%");
    // Mirror: baseline -1,000,000 -> current -1,025,000 (delta -25,000): pct = -2.5.
    // Before the fix this rendered "−2%" (wrong — a smaller magnitude than the +3% mirror above)
    // because `Math.round(-2.5)` is -2, not -3.
    assert.equal(fmtShiftPercentForStrike(-1_025_000, -25_000), "−3%");
  });

  it("a magnitude that rounds to exactly 0 reads \"0%\", never a misleading signed zero", () => {
    // baseline -1,000,000 -> current -1,003,000 (delta -3,000): pct = -0.3, rounds to 0.
    assert.equal(fmtShiftPercentForStrike(-1_003_000, -3_000), "0%");
  });
});
