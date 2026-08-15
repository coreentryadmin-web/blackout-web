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
    odteExpiry: exp,
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
    odteExpiry: exp,
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

test("buildOdteMatrixRows: marks king and walls from scoped levels", () => {
  const exp = "2026-08-15";
  const cells: Record<string, Record<string, number>> = {
    "100": { [exp]: 2_000_000 },
    "101": { [exp]: -3_000_000 },
    "102": { [exp]: 500_000 },
  };
  const out = buildOdteMatrixRows({
    strikes: [102, 101, 100],
    cells,
    odteExpiry: exp,
    spot: 101,
    lens: "gex",
    shift: null,
    priceBand: null,
  });
  const king = out.rows.find((r) => r.isKing);
  assert.ok(king, "king strike tagged");
  const putWall = out.rows.find((r) => r.isPutWall);
  assert.ok(putWall, "put wall tagged");
});
