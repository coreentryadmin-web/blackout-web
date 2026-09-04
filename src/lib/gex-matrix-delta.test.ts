import test from "node:test";
import assert from "node:assert/strict";
import { calculateMatrixDelta, calculateMatrixDeltaFull, type GexMatrix } from "./gex-matrix-delta";

function matrix(overrides: Partial<GexMatrix> = {}): GexMatrix {
  return {
    underlying: "SPY",
    spot: 500,
    strikes: [495, 500],
    expiries: ["2026-09-05"],
    gex: { "495": { "2026-09-05": 1_000 }, "500": { "2026-09-05": 2_000 } },
    asof: "2026-09-03T15:00:00.000Z",
    ...overrides,
  };
}

test("calculateMatrixDelta: no previous matrix returns null", () => {
  assert.equal(calculateMatrixDelta(null, matrix()), null);
});

test("calculateMatrixDelta: a strike with a change over threshold is included", () => {
  const previous = matrix();
  const current = matrix({ gex: { "495": { "2026-09-05": 1_000 }, "500": { "2026-09-05": 2_500 } } });
  const delta = calculateMatrixDelta(previous, current);
  assert.ok(delta);
  assert.equal(delta.updated_strikes.length, 1);
  assert.equal(delta.updated_strikes[0]!.strike, 500);
  assert.equal(delta.updated_strikes[0]!.gex_call, 2_500);
});

test("calculateMatrixDelta: a change under the $100 threshold is not included", () => {
  const previous = matrix();
  const current = matrix({ gex: { "495": { "2026-09-05": 1_000 }, "500": { "2026-09-05": 2_050 } } });
  assert.equal(calculateMatrixDelta(previous, current), null);
});

// BUG FIX (2026-09-03): gex_call/gex_put are summed from raw GEX cells (the same
// dollar-gamma arithmetic that produces IEEE-754 float noise like 7499.360000000001
// elsewhere in this codebase — round-floats.ts exists specifically to strip it at the
// response boundary). This SSE delta feed served the raw sum unrounded.
test("calculateMatrixDelta: gex_call/gex_put are rounded to 2dp, not raw float noise", () => {
  const previous = matrix();
  const current = matrix({
    gex: { "495": { "2026-09-05": 1_000 }, "500": { "2026-09-05": 7499.360000000001 } },
  });
  const delta = calculateMatrixDelta(previous, current);
  assert.ok(delta);
  assert.equal(delta.updated_strikes[0]!.gex_call, 7499.36, "rounded, not the raw IEEE-754 value");
});

test("calculateMatrixDelta: spot-only move (no strike changes) still rounds spot", () => {
  const previous = matrix({ spot: 500 });
  const current = matrix({ spot: 501.100000000001 }); // >= 1pt move, required to trigger this branch
  const delta = calculateMatrixDelta(previous, current);
  assert.ok(delta);
  assert.equal(delta.updated_strikes.length, 0);
  assert.equal(delta.spot, 501.1);
});

test("calculateMatrixDeltaFull: no previous matrix rounds every strike's gex sum", () => {
  const current = matrix({
    gex: { "495": { "2026-09-05": -1_000.005 }, "500": { "2026-09-05": 2_000.005 } },
  });
  const delta = calculateMatrixDeltaFull(null, current);
  assert.equal(delta.updated_strikes.length, 2);
  const s495 = delta.updated_strikes.find((s) => s.strike === 495)!;
  const s500 = delta.updated_strikes.find((s) => s.strike === 500)!;
  assert.equal(s495.gex_put, 1000.01, "negative sum rounds cleanly, no float noise");
  assert.equal(s500.gex_call, 2000.01);
});

test("calculateMatrixDeltaFull: with a previous matrix, every strike is force-included and rounded", () => {
  const previous = matrix();
  const current = matrix({ gex: { "495": { "2026-09-05": 1_000 }, "500": { "2026-09-05": 2_000.005 } } });
  const delta = calculateMatrixDeltaFull(previous, current);
  assert.equal(delta.updated_strikes.length, 2);
  assert.equal(delta.updated_strikes.find((s) => s.strike === 500)!.gex_call, 2000.01);
});
