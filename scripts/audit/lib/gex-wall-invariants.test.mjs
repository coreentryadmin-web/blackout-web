import test from "node:test";
import assert from "node:assert/strict";
import { wallsFromStrikeTotals, checkWallInvariants, canConstrain } from "./gex-wall-invariants.mjs";

/** Real SPY totals shape (2026-08-14): put wall below spot, call wall above — the common case. */
const SPY = { 760: -3e8, 765: -9e8, 770: -1e8, 775: 2e9, 780: 8e9, 785: 1e9 };

/**
 * Real SPX shape (2026-08-14, live): the most-negative strike sits ABOVE the most-positive one.
 * This is the case that broke the old ordering assertion — and, since #2417/#2521, it is also the
 * case that shows why the UNCONSTRAINED extremes are no longer what production serves.
 */
const SPX = { 7500: -1.468e9, 7800: 1.075e10, 7810: 6.809e9, 8000: -2.086e9 };

/**
 * Real SPY near-spot totals captured LIVE from prod at 2026-08-21T13:50:15Z, ~20 minutes into the
 * 09:30 ET open — the exact payload whose put wall the validator called a FAIL. Spot 764.87 sits
 * THIRTEEN CENTS below strike 765, which carries the whole book's most-negative gamma. The side
 * constraint therefore excludes 765 and production serves 760; the old unconstrained check
 * expected 765 and reported a confident FAIL on correct data.
 */
const SPY_OPEN_2026_08_21 = { 760: -1.962e9, 763: 1.081e8, 765: -2.936e9, 770: 8.155e8 };
const SPY_OPEN_SPOT = 764.87;

test("wallsFromStrikeTotals picks the extremes when unconstrained", () => {
  assert.deepEqual(wallsFromStrikeTotals(SPY), { callWall: 780, putWall: 765, n: 6 });
  assert.deepEqual(wallsFromStrikeTotals(SPX), { callWall: 7800, putWall: 8000, n: 4 });
});

test("wallsFromStrikeTotals side-constrains when given a spot", () => {
  // Production contract since #2417: call wall ABOVE spot, put wall BELOW it.
  assert.deepEqual(wallsFromStrikeTotals(SPY, 777.06), { callWall: 780, putWall: 765, n: 6 });
  // SPX: unconstrained put wall is 8000 (above spot); constrained it must be 7500.
  assert.deepEqual(wallsFromStrikeTotals(SPX, 7788.84), { callWall: 7800, putWall: 7500, n: 4 });
});

test("REGRESSION: the live 2026-08-21 open payload the validator false-FAILed", () => {
  // The unconstrained rule the audit lib used to apply...
  assert.deepEqual(wallsFromStrikeTotals(SPY_OPEN_2026_08_21), { callWall: 770, putWall: 765, n: 4 });
  // ...and the constrained rule production actually ships, which reproduces the SERVED 760 exactly.
  assert.deepEqual(wallsFromStrikeTotals(SPY_OPEN_2026_08_21, SPY_OPEN_SPOT), {
    callWall: 770,
    putWall: 760,
    n: 4,
  });
  // End to end: the served walls now verify clean instead of reporting a defect.
  const r = checkWallInvariants({
    callWall: 770,
    putWall: 760,
    strikeTotals: SPY_OPEN_2026_08_21,
    spot: SPY_OPEN_SPOT,
  });
  assert.equal(r.definitional, "pass");
  assert.equal(r.putOk, true);
  assert.equal(r.callOk, true);
});

test("the flip is driven by spot crossing the strike, not by elapsed time", () => {
  // 13 cents apart, opposite verdicts — the whole reason this looked like open-session flakiness.
  // Below the 765 strike: 765 is excluded, 760 is the wall.
  assert.equal(wallsFromStrikeTotals(SPY_OPEN_2026_08_21, 764.99).putWall, 760);
  // Above it: 765 qualifies and is the strongest negative below spot.
  assert.equal(wallsFromStrikeTotals(SPY_OPEN_2026_08_21, 765.12).putWall, 765);
});

test("no fallback to the wrong side: a wall with no qualifying strike is null", () => {
  // Every negative strike sits above spot -> there is genuinely no put wall below it.
  assert.deepEqual(wallsFromStrikeTotals({ 100: 5e8, 110: -9e8 }, 105), { callWall: null, putWall: null, n: 2 });
  // And a served null then AGREES with the derivation rather than failing.
  const r = checkWallInvariants({ callWall: null, putWall: null, strikeTotals: { 100: 5e8, 110: -9e8 }, spot: 105 });
  assert.equal(r.definitional, "pass");
});

test("an all-positive book has no put wall — not the least-positive strike", () => {
  // Accumulators start at 0 in production, so a put wall needs strictly negative gamma.
  assert.deepEqual(wallsFromStrikeTotals({ 100: 1e8, 110: 5e8 }), { callWall: 110, putWall: null, n: 2 });
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
  assert.equal(r.constrained, true);
});

test("SPX: the constrained put wall is 7500, so the old 8000 is now a real mismatch", () => {
  // #2178 pinned this book as a definitional PASS with put_wall 8000, and that was correct THEN.
  // #2417 changed the shipped definition: 8000 sits above spot, so it is not a put wall any more.
  // Keeping the old expectation would make this audit lib disagree with production by design.
  const r = checkWallInvariants({ callWall: 7800, putWall: 8000, strikeTotals: SPX, spot: 7788.84 });
  assert.equal(r.definitional, "fail");
  assert.equal(r.callOk, true);
  assert.equal(r.putOk, false);
  assert.equal(r.expected.putWall, 7500);
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

test("a missing spot SKIPS rather than silently checking the pre-#2417 rule", () => {
  // The dangerous case: without this guard the check falls back to the unconstrained argmin and
  // reports FAIL on healthy data whenever the two rules diverge.
  for (const spot of [null, undefined, 0, -1, "abc"]) {
    const r = checkWallInvariants({ callWall: 770, putWall: 760, strikeTotals: SPY_OPEN_2026_08_21, spot });
    assert.equal(r.definitional, "skip", `spot=${spot}`);
    assert.equal(r.constrained, false);
    assert.match(r.reason, /side-constrained/);
  }
  assert.equal(canConstrain(764.87), true);
});

test("null walls fail definitionally when a qualifying strike exists", () => {
  const r = checkWallInvariants({ callWall: null, putWall: null, strikeTotals: SPY, spot: 777 });
  assert.equal(r.definitional, "fail");
  assert.equal(r.ordering, "unknown");
});

test("distance percentages are reported for context, not asserted", () => {
  // A put wall far below spot is legitimate — no band check may treat distance as a failure.
  // (Fixture updated for #2417: the old one put the call wall BELOW spot at 225 vs 225.97, which
  //  is precisely the inverted level production no longer serves.)
  const r = checkWallInvariants({
    callWall: 230, putWall: 190,
    strikeTotals: { 190: -5e8, 230: 9e8 }, spot: 225.97,
  });
  assert.equal(r.definitional, "pass");
  assert.ok(r.put_dist_pct < -15 && r.put_dist_pct > -16, `got ${r.put_dist_pct}`);
  assert.ok(r.call_dist_pct > 0 && r.call_dist_pct < 2, `got ${r.call_dist_pct}`);
});

test("a zero strike key is a real strike, not absent", () => {
  // Number(null) === 0 guard: a 0 key must not be silently dropped or coerced from null.
  const r = wallsFromStrikeTotals({ 0: -5, 100: 5 });
  assert.equal(r.putWall, 0);
  assert.equal(r.callWall, 100);
});
