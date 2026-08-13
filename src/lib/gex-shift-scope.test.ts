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
});
