import { test } from "node:test";
import assert from "node:assert/strict";
import { wallsFromStrikeTotals } from "@/lib/providers/gex-cross-validation-core";
import { computeGexWalls, mapFromStrikeTotalsRecord, nextWallScope, wallsHaveNodes } from "./gex-wall-levels";

test("computeGexWalls ranks call walls (positive strikes) strongest-first", () => {
  const ladder = new Map<number, number>([
    [6700, -1e9],
    [6750, 5e8],
    [6800, 2e9],
    [6850, -5e8],
  ]);
  const { callWalls, putWalls } = computeGexWalls(ladder);
  assert.deepEqual(callWalls.map((w) => w.strike), [6800, 6750]);
  assert.deepEqual(putWalls.map((w) => w.strike), [6700, 6850]);
});

test("computeGexWalls: the #1 wall per side always matches wallsFromStrikeTotals' single-pick semantics", () => {
  const ladder = new Map<number, number>([
    [6700, -3e9],
    [6710, 1e8],
    [6720, 2e9],
    [6730, -1e8],
  ]);
  const strikeTotals = { "6700": -3e9, "6710": 1e8, "6720": 2e9, "6730": -1e8 };
  const single = wallsFromStrikeTotals(strikeTotals);
  const { callWalls, putWalls } = computeGexWalls(ladder);
  assert.equal(callWalls[0]?.strike, single.callWall);
  assert.equal(putWalls[0]?.strike, single.putWall);
});

test("computeGexWalls sizes each wall by its share of total |gamma| across the ladder", () => {
  // |gamma| total = 2e9 (call) + 1e9 (put) = 3e9. Call wall is 2/3, put wall is 1/3.
  const ladder = new Map<number, number>([
    [6800, 2e9],
    [6700, -1e9],
  ]);
  const { callWalls, putWalls } = computeGexWalls(ladder);
  assert.ok(Math.abs(callWalls[0]!.pct - (200 / 3)) < 1e-9);
  assert.ok(Math.abs(putWalls[0]!.pct - (100 / 3)) < 1e-9);
  assert.equal(callWalls[0]!.notional, 2e9);
  assert.equal(putWalls[0]!.notional, 1e9);
});

test("computeGexWalls caps each side at maxPerSide, dropping the weakest strikes", () => {
  const ladder = new Map<number, number>([
    [6800, 4e9],
    [6810, 3e9],
    [6820, 2e9],
    [6830, 1e9], // dropped — 4th strongest call strike, cap is 3
  ]);
  const { callWalls } = computeGexWalls(ladder, { maxPerSide: 3 });
  assert.equal(callWalls.length, 3);
  assert.deepEqual(callWalls.map((w) => w.strike), [6800, 6810, 6820]);
});

test("computeGexWalls defaults to 6 nodes per side when maxPerSide is omitted", () => {
  const ladder = new Map<number, number>([
    [1, 6e9],
    [2, 5e9],
    [3, 4e9],
    [4, 3e9],
    [5, 2e9],
    [6, 1e9],
  ]);
  const { callWalls } = computeGexWalls(ladder);
  assert.equal(callWalls.length, 6);
});

test("computeGexWalls returns empty arrays for an empty ladder", () => {
  assert.deepEqual(computeGexWalls(new Map()), { callWalls: [], putWalls: [] });
});

test("computeGexWalls returns an empty put side when every strike is net-positive", () => {
  const ladder = new Map<number, number>([
    [6800, 2e9],
    [6850, 5e8],
  ]);
  const { callWalls, putWalls } = computeGexWalls(ladder);
  assert.equal(callWalls[0]?.strike, 6800);
  assert.deepEqual(putWalls, []);
});

test("computeGexWalls returns an empty call side when every strike is net-negative", () => {
  const ladder = new Map<number, number>([
    [6800, -2e9],
    [6850, -5e8],
  ]);
  const { callWalls, putWalls } = computeGexWalls(ladder);
  assert.deepEqual(callWalls, []);
  assert.equal(putWalls[0]?.strike, 6800);
});

test("mapFromStrikeTotalsRecord converts a strike_totals record into the Map computeGexWalls expects", () => {
  const map = mapFromStrikeTotalsRecord({ "6800": 2e9, "6700": -1e9 });
  assert.equal(map.get(6800), 2e9);
  assert.equal(map.get(6700), -1e9);
  const { callWalls, putWalls } = computeGexWalls(map);
  assert.equal(callWalls[0]?.strike, 6800);
  assert.equal(putWalls[0]?.strike, 6700);
});

test("mapFromStrikeTotalsRecord drops non-finite keys/values", () => {
  const map = mapFromStrikeTotalsRecord({ "6800": 2e9, garbage: 5e8, "6700": NaN });
  assert.deepEqual([...map.entries()], [[6800, 2e9]]);
});

test("nextWallScope advances the scope when the fetch yields expiries", () => {
  const prev = { expiries: undefined, fetchedAt: 0 };
  const next = nextWallScope(prev, 1000, { near_term_expiries: ["2026-07-07", "2026-07-08"] });
  assert.deepEqual(next, { expiries: ["2026-07-07", "2026-07-08"], fetchedAt: 1000 });
});

test("nextWallScope keeps the previous scope on a scope-free (e.g. emptyHeatmap) result, not undefined", () => {
  const prev = { expiries: ["2026-07-07"], fetchedAt: 1000 };
  const next = nextWallScope(prev, 16000, {}); // emptyHeatmap() omits near_term_expiries entirely
  assert.deepEqual(next, { expiries: ["2026-07-07"], fetchedAt: 16000 });
});

test("nextWallScope keeps the previous scope on a thrown fetch (null result)", () => {
  const prev = { expiries: ["2026-07-07"], fetchedAt: 1000 };
  const next = nextWallScope(prev, 16000, null);
  assert.deepEqual(next, { expiries: ["2026-07-07"], fetchedAt: 16000 });
});

test("nextWallScope keeps the previous scope on an explicitly empty expiries array", () => {
  const prev = { expiries: ["2026-07-07"], fetchedAt: 1000 };
  const next = nextWallScope(prev, 16000, { near_term_expiries: [] });
  assert.deepEqual(next, { expiries: ["2026-07-07"], fetchedAt: 16000 });
});

// Regression for the 2026-09-04 audit finding: computeGexWalls picked the largest-|gamma| strike
// on each side with no regard for spot, so a "call wall" (resistance) could sit BELOW spot and a
// "put wall" (support) ABOVE it — the same bug class PR #2417 fixed for wallsFromStrikeTotals but
// never propagated here. Reproduces the live IBIT/NDX shapes (call 46 vs spot 46.06; call 29275 +
// put 29600 both wrong-side vs spot 29482.32) as regression fixtures.
test("computeGexWalls: with spot supplied, side-constrains exactly like wallsFromStrikeTotals — no call wall below spot, no put wall above it", () => {
  // Mirrors the live IBIT case: strike 46 (below spot) carries more |gamma| than any strike above
  // spot, so the unconstrained scan picked it as the "call wall" (resistance) below current price.
  const ladder = new Map<number, number>([
    [46, 5e8], // largest positive-gamma strike, but BELOW spot — must be excluded
    [47, 2e8], // smaller, but above spot — the honest call wall
    [45, -3e8], // put side, correctly below spot
  ]);
  const spot = 46.06;
  const unconstrained = computeGexWalls(ladder);
  assert.equal(unconstrained.callWalls[0]?.strike, 46, "sanity: unconstrained reproduces the live bug");

  const constrained = computeGexWalls(ladder, { spot });
  assert.equal(constrained.callWalls[0]?.strike, 47, "call wall must sit above spot");
  assert.equal(constrained.putWalls[0]?.strike, 45, "put wall correctly stays below spot");
  assert.ok(
    constrained.callWalls.every((w) => w.strike > spot),
    "no callWalls entry may sit at/below spot"
  );
  assert.ok(
    constrained.putWalls.every((w) => w.strike < spot),
    "no putWalls entry may sit at/above spot"
  );
});

test("computeGexWalls: both sides can be inverted simultaneously (live NDX dte=all shape) — spot fixes both", () => {
  const ladder = new Map<number, number>([
    [29275, 4e9], // call bucket, below spot — the live inverted "call wall"
    [29600, -6e9], // put bucket, above spot — the live inverted "put wall"
    [29500, 2e9], // honest call wall, above spot
    [29400, -1e9], // honest put wall, below spot
  ]);
  const spot = 29482.32;
  const { callWalls, putWalls } = computeGexWalls(ladder, { spot });
  assert.equal(callWalls[0]?.strike, 29500);
  assert.equal(putWalls[0]?.strike, 29400);
});

test("computeGexWalls: NO FALLBACK TO THE WRONG SIDE — a side with no qualifying strike returns empty, not the nearest wrong-side strike", () => {
  // Every positive-gamma strike sits below spot: there is no honest call wall, and the function
  // must say so (empty array) rather than serve 46 as "the call wall" anyway.
  const ladder = new Map<number, number>([
    [44, 3e8],
    [45, 5e8],
  ]);
  const { callWalls } = computeGexWalls(ladder, { spot: 46 });
  assert.deepEqual(callWalls, []);
});

test("computeGexWalls: omitting spot preserves the exact unconstrained behavior (VEX/vanna lens has no above/below-spot geometry)", () => {
  const ladder = new Map<number, number>([
    [46, 5e8],
    [47, 2e8],
    [45, -3e8],
  ]);
  assert.deepEqual(computeGexWalls(ladder), computeGexWalls(ladder, { spot: undefined }));
  assert.equal(computeGexWalls(ladder).callWalls[0]?.strike, 46);
});

test("computeGexWalls: pct stays a share of TOTAL |gamma| across the ladder, not just the qualifying side — the constraint filters candidates, not the denominator", () => {
  const ladder = new Map<number, number>([
    [46, 5e8], // excluded by the spot constraint, but still counts toward the |gamma| total
    [47, 2e8],
    [45, -3e8],
  ]);
  const totalAbsGamma = 5e8 + 2e8 + 3e8;
  const { callWalls } = computeGexWalls(ladder, { spot: 46.06 });
  assert.ok(Math.abs(callWalls[0]!.pct - (2e8 / totalAbsGamma) * 100) < 1e-9);
});

test("wallsHaveNodes distinguishes a cold/empty ladder from real walls", () => {
  // The Vector DTE "all" horizon read relies on this to detect a cold-task synchronous
  // miss (empty walls but the flip still fetched) and fall back to the heatmap. A plain
  // `!= null` check can't tell these apart because computeGexWalls returns {[],[]} not null.
  assert.equal(wallsHaveNodes(null), false, "null → no nodes");
  assert.equal(wallsHaveNodes(undefined), false, "undefined → no nodes");
  assert.equal(wallsHaveNodes({ callWalls: [], putWalls: [] }), false, "cold/empty ladder → no nodes");
  assert.equal(wallsHaveNodes(computeGexWalls(new Map())), false, "computeGexWalls of empty ladder → no nodes");
  assert.equal(
    wallsHaveNodes({ callWalls: [{ strike: 6800, pct: 50 }], putWalls: [] }),
    true,
    "a single call node → has nodes"
  );
  assert.equal(
    wallsHaveNodes({ callWalls: [], putWalls: [{ strike: 6700, pct: 50 }] }),
    true,
    "a single put node → has nodes"
  );
});
