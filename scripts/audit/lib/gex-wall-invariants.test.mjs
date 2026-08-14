import test from "node:test";
import assert from "node:assert/strict";
import { wallsFromStrikeTotals, checkWallInvariants } from "./gex-wall-invariants.mjs";

/** Real SPY totals shape (2026-08-14): put wall below spot, call wall above — the common case. */
const SPY = { 760: -3e8, 765: -9e8, 770: -1e8, 775: 2e9, 780: 8e9, 785: 1e9 };

/**
 * Real SPX shape (2026-08-14, live): the most-negative strike sits ABOVE the most-positive one.
 * This is the case that broke the old ordering assertion.
 */
const SPX = { 7500: -1.468e9, 7800: 1.075e10, 7810: 6.809e9, 8000: -2.086e9 };

test("wallsFromStrikeTotals picks the extremes", () => {
  assert.deepEqual(wallsFromStrikeTotals(SPY), { callWall: 780, putWall: 765, n: 6 });
  assert.deepEqual(wallsFromStrikeTotals(SPX), { callWall: 7800, putWall: 8000, n: 4 });
});

test("wallsFromStrikeTotals never invents a wall from empty/garbage input", () => {
  assert.deepEqual(wallsFromStrikeTotals({}), { callWall: null, putWall: null, n: 0 });
  assert.deepEqual(wallsFromStrikeTotals(null), { callWall: null, putWall: null, n: 0 });
  assert.deepEqual(wallsFromStrikeTotals({ abc: 5, 700: "x" }), { callWall: null, putWall: null, n: 0 });
});

test("SPY: definitional pass, ordering normal", () => {
  const r = checkWallInvariants({ callWall: 780, putWall: 765, strikeTotals: SPY, spot: 777.06 });
  assert.equal(r.definitional, "pass");
  assert.equal(r.ordering, "normal");
});

test("SPX inverted book: definitional PASS even though ordering is inverted", () => {
  // The whole point. The old check FAILed here on correct data.
  const r = checkWallInvariants({ callWall: 7800, putWall: 8000, strikeTotals: SPX, spot: 7788.84 });
  assert.equal(r.definitional, "pass");
  assert.equal(r.ordering, "inverted");
});

test("swapped walls are caught — which the ordering test alone could not do reliably", () => {
  const r = checkWallInvariants({ callWall: 765, putWall: 780, strikeTotals: SPY, spot: 777 });
  assert.equal(r.definitional, "fail");
  assert.equal(r.callOk, false);
  assert.equal(r.putOk, false);
});

test("a stale wall pointing at a strike that is no longer the extreme is caught", () => {
  const r = checkWallInvariants({ callWall: 785, putWall: 765, strikeTotals: SPY, spot: 777 });
  assert.equal(r.definitional, "fail");
  assert.equal(r.callOk, false);
  assert.equal(r.putOk, true);
});

test("missing strike_totals SKIPS rather than failing", () => {
  // Absence of evidence is not a defect: a payload without totals cannot be judged.
  const r = checkWallInvariants({ callWall: 780, putWall: 765, strikeTotals: {}, spot: 777 });
  assert.equal(r.definitional, "skip");
  assert.match(r.reason, /no usable strike_totals/);
});

test("null walls fail definitionally when totals exist, and report unknown ordering", () => {
  const r = checkWallInvariants({ callWall: null, putWall: null, strikeTotals: SPY, spot: 777 });
  assert.equal(r.definitional, "fail");
  assert.equal(r.ordering, "unknown");
});

test("distance percentages are reported for context, not asserted", () => {
  // NVDA's put wall sat 15.9% below spot on 2026-08-14 — far, and entirely legitimate, so no
  // band check may treat distance as a failure.
  const r = checkWallInvariants({
    callWall: 225, putWall: 190,
    strikeTotals: { 190: -5e8, 225: 9e8 }, spot: 225.97,
  });
  assert.equal(r.definitional, "pass");
  assert.ok(r.put_dist_pct < -15 && r.put_dist_pct > -16, `got ${r.put_dist_pct}`);
  assert.ok(Math.abs(r.call_dist_pct) < 1);
});

test("a zero strike key is a real strike, not absent", () => {
  // Number(null) === 0 guard: a 0 key must not be silently dropped or coerced from null.
  const r = wallsFromStrikeTotals({ 0: -5, 100: 5 });
  assert.equal(r.putWall, 0);
  assert.equal(r.callWall, 100);
});
