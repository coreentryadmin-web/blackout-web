import assert from "node:assert/strict";
import test from "node:test";
import {
  matrixCellValueForScope,
  matrixRailTitle,
  matrixScopeExpiries,
  matrixScopeExpiryNote,
  strikeTotalsForScope,
} from "./vector-matrix-horizon";

test("matrixScopeExpiries: 0DTE picks today column", () => {
  const expiries = ["2026-08-14", "2026-08-15", "2026-08-22"];
  assert.deepEqual(matrixScopeExpiries(expiries, "0dte", "2026-08-15"), ["2026-08-15"]);
});

test("matrixScopeExpiries: weekly sums front-week expiries", () => {
  const expiries = ["2026-08-15", "2026-08-22", "2026-09-19"];
  assert.deepEqual(matrixScopeExpiries(expiries, "weekly", "2026-08-15"), [
    "2026-08-15",
    "2026-08-22",
  ]);
});

test("matrixCellValueForScope: sums across expiries", () => {
  const cells = {
    "100": { "2026-08-15": 1_000_000, "2026-08-22": 500_000 },
  };
  assert.equal(matrixCellValueForScope(cells, 100, ["2026-08-15", "2026-08-22"]), 1_500_000);
});

test("strikeTotalsForScope: builds per-strike map", () => {
  const cells = {
    "100": { "2026-08-15": 1, "2026-08-22": 2 },
    "101": { "2026-08-15": -3 },
  };
  assert.deepEqual(strikeTotalsForScope(cells, [100, 101], ["2026-08-15", "2026-08-22"]), {
    "100": 3,
    "101": -3,
  });
});

test("matrixRailTitle: honest labels per horizon", () => {
  assert.equal(matrixRailTitle("0dte"), "0DTE Matrix");
  assert.equal(matrixRailTitle("weekly"), "Weekly Matrix");
  assert.equal(matrixRailTitle("monthly"), "Monthly Matrix");
  assert.equal(matrixRailTitle("all"), "All Matrix");
});

test("matrixScopeExpiryNote: surfaces nearest-expiry fallback on 0DTE off-session days", () => {
  assert.equal(matrixScopeExpiryNote(["2026-08-17"], "0dte", "2026-08-15"), "Nearest expiry · Aug 17");
  assert.equal(matrixScopeExpiryNote(["2026-08-15"], "0dte", "2026-08-15"), null);
});
