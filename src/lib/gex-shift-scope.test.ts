import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { matrixShiftDeltaForStrikeScoped, sumMetricCellsForExpiries } from "./gex-shift-scope";

describe("gex-shift-scope", () => {
  it("sumMetricCellsForExpiries sums only selected expiry columns", () => {
    const row = { "2026-08-13": 100, "2026-08-20": 200 };
    assert.equal(sumMetricCellsForExpiries(row, ["2026-08-13"]), 100);
    assert.equal(sumMetricCellsForExpiries(row, ["2026-08-13", "2026-08-20"]), 300);
    assert.equal(sumMetricCellsForExpiries(undefined, ["2026-08-13"]), 0);
  });

  it("matrixShiftDeltaForStrikeScoped uses full-book delta when unscoped", () => {
    const d = matrixShiftDeltaForStrikeScoped({
      shift: { delta_by_strike: { "6400": 500_000 } },
      cells: {},
      selectedExpiries: null,
      strike: 6400,
    });
    assert.equal(d, 500_000);
  });

  it("matrixShiftDeltaForStrikeScoped diffs scoped cells vs baseline for one DTE", () => {
    const d = matrixShiftDeltaForStrikeScoped({
      shift: {
        baseline_cells: {
          "6400": { "2026-08-20": 1_000_000 },
        },
      },
      cells: {
        "6400": { "2026-08-20": 1_550_000 },
      },
      selectedExpiries: ["2026-08-20"],
      strike: 6400,
    });
    assert.equal(d, 550_000);
  });

  it("matrixShiftDeltaForStrikeScoped ignores other expiries in the same row", () => {
    const d = matrixShiftDeltaForStrikeScoped({
      shift: {
        baseline_cells: {
          "6400": { "2026-08-13": 900_000, "2026-08-20": 1_000_000 },
        },
      },
      cells: {
        "6400": { "2026-08-13": 2_000_000, "2026-08-20": 1_550_000 },
      },
      selectedExpiries: ["2026-08-20"],
      strike: 6400,
    });
    assert.equal(d, 550_000);
  });

  it("matrixShiftDeltaForStrikeScoped returns undefined when baseline_cells missing", () => {
    assert.equal(
      matrixShiftDeltaForStrikeScoped({
        shift: { delta_by_strike: { "6400": 1 } },
        cells: { "6400": { "2026-08-20": 100 } },
        selectedExpiries: ["2026-08-20"],
        strike: 6400,
      }),
      undefined,
    );
  });

  // BUG FIX (absence-as-measurement): a strike with REAL coverage on both sides whose net
  // change happens to be exactly zero is a MEASURED "no change", not a "never checked" — it
  // must return 0, not undefined. Before this fix, `d === 0` made the two indistinguishable,
  // which silently dropped the DR% chip for a genuinely unchanged strike (same visible symptom
  // as a strike outside the baseline entirely).
  it("matrixShiftDeltaForStrikeScoped returns a real 0 (not undefined) for a measured, unchanged strike", () => {
    const d = matrixShiftDeltaForStrikeScoped({
      shift: {
        baseline_cells: {
          "6400": { "2026-08-20": 1_000_000 },
        },
      },
      cells: {
        "6400": { "2026-08-20": 1_000_000 },
      },
      selectedExpiries: ["2026-08-20"],
      strike: 6400,
    });
    assert.equal(d, 0);
  });

  it("matrixShiftDeltaForStrikeScoped still returns undefined when the strike has no coverage on either side (genuinely unknown, not a measured zero)", () => {
    const d = matrixShiftDeltaForStrikeScoped({
      shift: {
        baseline_cells: {
          "6400": { "2026-08-13": 900_000 }, // a different expiry than selected below
        },
      },
      cells: {
        "6400": { "2026-08-13": 950_000 }, // same — no data for "2026-08-20" on either side
      },
      selectedExpiries: ["2026-08-20"],
      strike: 6400,
    });
    assert.equal(d, undefined);
  });

  it("matrixShiftDeltaForStrikeScoped returns a real (possibly zero-crossing) delta when only one side has coverage", () => {
    const d = matrixShiftDeltaForStrikeScoped({
      shift: {
        baseline_cells: {
          "6400": { "2026-08-20": 500_000 },
        },
      },
      cells: {
        // Current row has no entry for this strike at all — sums to 0 — but the baseline DID
        // carry real data for the selected expiry, so this is a real, measured move to zero,
        // not an absence.
        "6400": {},
      },
      selectedExpiries: ["2026-08-20"],
      strike: 6400,
    });
    assert.equal(d, -500_000);
  });
});
