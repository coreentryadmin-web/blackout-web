import test from "node:test";
import assert from "node:assert/strict";
import { wallsFromStrikeTotals, checkWallInvariants } from "./gex-wall-invariants.mjs";

/** Real SPY totals shape (2026-08-14): put wall below spot, call wall above — the common case. */
const SPY = { 760: -3e8, 765: -9e8, 770: -1e8, 775: 2e9, 780: 8e9, 785: 1e9 };

/**
 * Real SPX shape (2026-08-14, live): the most-negative strike (8000) sits ABOVE spot while the
 * most-positive (7800) sits at/above it. Under the SIDE-CONSTRAINED definition production serves
 * since #2417/#2521, 8000 is NOT the put wall — a put wall above spot is inverted. The put wall is
 * the largest-negative strike BELOW spot (7500).
 */
const SPX = { 7500: -1.468e9, 7800: 1.075e10, 7810: 6.809e9, 8000: -2.086e9 };
const SPX_SPOT = 7788.84;

test("wallsFromStrikeTotals with no spot → unconstrained argmax/argmin (production's no-quote fallback)", () => {
  assert.deepEqual(wallsFromStrikeTotals(SPY), { callWall: 780, putWall: 765, n: 6 });
  assert.deepEqual(wallsFromStrikeTotals(SPX), { callWall: 7800, putWall: 8000, n: 4 });
});

test("wallsFromStrikeTotals WITH spot → side-constrained (put wall must sit below spot)", () => {
  // SPY: 765 is already below spot, so constrained == unconstrained here.
  assert.deepEqual(wallsFromStrikeTotals(SPY, 777.06), { callWall: 780, putWall: 765, n: 6 });
  // SPX: the raw argmin 8000 sits ABOVE spot and is rejected; the put wall is 7500 (largest
  // negative BELOW spot). The call wall stays 7800 (largest positive AT/ABOVE spot).
  assert.deepEqual(wallsFromStrikeTotals(SPX, SPX_SPOT), { callWall: 7800, putWall: 7500, n: 4 });
});

test("wallsFromStrikeTotals never invents a wall from empty/garbage input", () => {
  assert.deepEqual(wallsFromStrikeTotals({}), { callWall: null, putWall: null, n: 0 });
  assert.deepEqual(wallsFromStrikeTotals(null), { callWall: null, putWall: null, n: 0 });
  assert.deepEqual(wallsFromStrikeTotals({ abc: 5, 700: "x" }), { callWall: null, putWall: null, n: 0 });
});

test("wallsFromStrikeTotals returns null on the side with no qualifying strike, never a wrong-side wall", () => {
  // spot 770: no positive strike above it (780/785 are the positives here, both above → ok), but
  // flip the case: all positive gamma sits BELOW spot → no call wall above spot → null, not inverted.
  const belowOnly = { 750: 9e8, 755: 5e8, 760: -3e8 };
  assert.deepEqual(wallsFromStrikeTotals(belowOnly, 800), { callWall: null, putWall: 760, n: 3 });
});

test("SPY: definitional pass, ordering normal", () => {
  const r = checkWallInvariants({ callWall: 780, putWall: 765, strikeTotals: SPY, spot: 777.06 });
  assert.equal(r.definitional, "pass");
  assert.equal(r.ordering, "normal");
});

test("SPX: a served put wall ABOVE spot is now a DEFECT, not a legitimate inverted book", () => {
  // The whole point of the 2026-08-21 change. The old checker PASSED 8000 here ("inverted is
  // legitimate"); production no longer serves it, so a payload that does is inverted and wrong.
  const r = checkWallInvariants({ callWall: 7800, putWall: 8000, strikeTotals: SPX, spot: SPX_SPOT });
  assert.equal(r.definitional, "fail");
  assert.equal(r.putOk, false);
  assert.equal(r.callOk, true);
  assert.equal(r.expected.putWall, 7500, "the correct side-constrained put wall is 7500, below spot");
});

test("SPX: the correctly side-constrained put wall (7500, below spot) passes", () => {
  const r = checkWallInvariants({ callWall: 7800, putWall: 7500, strikeTotals: SPX, spot: SPX_SPOT });
  assert.equal(r.definitional, "pass");
});

test("an inverted CALL wall (below spot) is caught — the exact class #2521 fixed in production", () => {
  // spot 764.74, served call_wall 480-style case scaled to SPY: the global-max-positive strike sits
  // below spot, so the unconstrained scan would have served it. The constrained call wall is the
  // largest positive ABOVE spot.
  const totals = { 760: 5e9, 770: 2e9, 755: -3e8 }; // 760 is the global max positive, but < spot
  const r = checkWallInvariants({ callWall: 760, putWall: 755, strikeTotals: totals, spot: 764.74 });
  assert.equal(r.definitional, "fail", "call wall 760 sits below spot — inverted");
  assert.equal(r.callOk, false);
  assert.equal(r.expected.callWall, 770, "the real call wall is 770, above spot");
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
  // A put wall far below spot is entirely legitimate (support well under price), so no band check
  // may treat distance as a failure. Call wall sits above spot (230 > 225.97), as it must.
  const r = checkWallInvariants({
    callWall: 230, putWall: 190,
    strikeTotals: { 190: -5e8, 230: 9e8 }, spot: 225.97,
  });
  assert.equal(r.definitional, "pass");
  assert.ok(r.put_dist_pct < -15 && r.put_dist_pct > -16, `got ${r.put_dist_pct}`);
  assert.ok(Math.abs(r.call_dist_pct) < 2);
});

test("a zero strike key is a real strike, not absent (no-spot unconstrained path)", () => {
  // Number(null) === 0 guard: a 0 key must not be silently dropped or coerced from null.
  const r = wallsFromStrikeTotals({ 0: -5, 100: 5 });
  assert.equal(r.putWall, 0);
  assert.equal(r.callWall, 100);
});
