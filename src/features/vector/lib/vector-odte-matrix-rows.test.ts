import assert from "node:assert/strict";
import test from "node:test";
import { buildOdteMatrixRows } from "./vector-odte-matrix-rows";

test("buildOdteMatrixRows: 0DTE column values + DR% near spot", () => {
  const exp = "2026-08-15";
  const cells: Record<string, Record<string, number>> = {
    "100": { [exp]: 1_000_000 },
    "101": { [exp]: -500_000 },
    "102": { [exp]: 250_000 },
  };
  const out = buildOdteMatrixRows({
    strikes: [102, 101, 100],
    cells,
    scopeExpiries: [exp],
    spot: 101,
    lens: "gex",
    shift: {
      available: true,
      delta_by_strike: { "101": 250_000 },
    },
    priceBand: null,
  });
  assert.equal(out.rows.length, 3);
  assert.equal(out.spotIdx, 1);
  assert.ok(out.peak >= 1_000_000);
  const spotRow = out.rows[1]!;
  assert.equal(spotRow.strike, 101);
  assert.equal(spotRow.value, -500_000);
  assert.equal(spotRow.driftLabel, null, "spot row skips DR%");
  const above = out.rows[0]!;
  assert.equal(above.strike, 102);
  assert.equal(above.driftLabel, "—", "DR% hidden when baseline ~zero");
  const below = out.rows[2]!;
  assert.equal(below.strike, 100);
  assert.ok(below.driftLabel === null || below.driftLabel === "—");
});

test("buildOdteMatrixRows: priceBand scopes visible strikes", () => {
  const exp = "2026-08-15";
  const cells: Record<string, Record<string, number>> = {
    "90": { [exp]: 100 },
    "100": { [exp]: 200 },
    "110": { [exp]: 300 },
  };
  const out = buildOdteMatrixRows({
    strikes: [110, 100, 90],
    cells,
    scopeExpiries: [exp],
    spot: 100,
    lens: "gex",
    shift: null,
    priceBand: { min: 98, max: 102 },
  });
  assert.deepEqual(
    out.rows.map((r) => r.strike),
    [100]
  );
});

test("buildOdteMatrixRows: marks king and walls from scoped levels, side-constrained by spot", () => {
  // Regression for the 2026-09-04 audit follow-up to #3495/#2417: recomputeScopedGexLevels (the
  // level source for isCallWall/isPutWall here) is now side-constrained by spot. The AT-spot
  // strike (101) carries the single largest |value| in this book, so it wins King — but it must
  // NOT be tagged as either wall, since it sits on neither side of spot. Before the fix this
  // fixture's put wall would have resolved to 101 (largest-magnitude value anywhere, ignoring
  // side) instead of the real below-spot put wall at 99.
  const exp = "2026-08-15";
  const cells: Record<string, Record<string, number>> = {
    "99": { [exp]: -3_000_000 },
    "101": { [exp]: 5_000_000 },
    "103": { [exp]: 1_000_000 },
  };
  const out = buildOdteMatrixRows({
    strikes: [103, 101, 99],
    cells,
    scopeExpiries: [exp],
    spot: 101,
    lens: "gex",
    shift: null,
    priceBand: null,
  });
  const king = out.rows.find((r) => r.isKing);
  assert.ok(king, "king strike tagged");
  assert.equal(king?.strike, 101, "AT-spot strike wins King on raw magnitude");
  assert.equal(king?.isCallWall, false, "AT-spot strike is not a call wall");
  assert.equal(king?.isPutWall, false, "AT-spot strike is not a put wall");

  const putWall = out.rows.find((r) => r.isPutWall);
  assert.ok(putWall, "put wall tagged");
  assert.equal(putWall?.strike, 99, "put wall must sit below spot");

  const callWall = out.rows.find((r) => r.isCallWall);
  assert.ok(callWall, "call wall tagged");
  assert.equal(callWall?.strike, 103, "call wall must sit above spot");
});

test("buildOdteMatrixRows: weekly scope sums multiple expiries per strike", () => {
  const cells: Record<string, Record<string, number>> = {
    "100": { "2026-08-15": 1_000_000, "2026-08-22": 500_000 },
    "101": { "2026-08-15": -200_000, "2026-08-22": -300_000 },
  };
  const out = buildOdteMatrixRows({
    strikes: [101, 100],
    cells,
    scopeExpiries: ["2026-08-15", "2026-08-22"],
    spot: 100,
    lens: "gex",
    shift: null,
    priceBand: null,
  });
  assert.equal(out.rows.find((r) => r.strike === 100)?.value, 1_500_000);
  assert.equal(out.rows.find((r) => r.strike === 101)?.value, -500_000);
});
