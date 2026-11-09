import test from "node:test";
import assert from "node:assert/strict";
import { trimLadderDistanceLabel } from "./PlayTerminal";

// REGRESSION: the real trim-scale ladder's `distTo` closure (TrimScaleLadder, rendered for every
// WATCH/OPEN trim_scale play on the Night Hawk command deck) computed its `pct` leg with a bare
// `Math.round(pct)` and a separately-decided `pct >= 0 ? "+" : ""` sign prefix. `Math.round` ties
// toward +Infinity (`Math.round(-12.5) === -12` but `Math.round(12.5) === 13`), so a stop/target
// level sitting exactly a half-percent tie away from the live mark rendered a SMALLER magnitude
// on the loss side than the mirror-image gain side — e.g. a stop 12.5% below mark showed "-12%
// away" while an equidistant target 12.5% above showed "+13% away", the same sign-biased
// rounding-tie paste already fixed in this file's own `signPct` (and in
// `fmt-money.ts`/`round-floats.ts`/`shift-math.ts`'s `fmtShiftPercentForStrike` elsewhere in the
// repo). Test fixtures use mark=8 (a power of 2) so level/mark divides EXACTLY in binary
// floating point and lands on a true .5 tie — a mark/level pair like 100/102.5 looks like a tie
// in decimal but is actually ~2.499999999999991 once divided in IEEE-754, which would mask this
// exact bug (both the buggy and fixed formula round that to the same value).
test("trimLadderDistanceLabel: equal-magnitude below/above ties render the SAME rounded magnitude", () => {
  // mark=8, level=7 -> dollars=-1.00, pct=-12.5% (an exact binary tie)
  assert.equal(trimLadderDistanceLabel(7, 8), " · -1.00 / -13% away"); // was " · -1.00 / -12% away" pre-fix
  // mark=8, level=9 -> dollars=+1.00, pct=+12.5% (the mirror tie)
  assert.equal(trimLadderDistanceLabel(9, 8), " · +1.00 / +13% away");
});

test("trimLadderDistanceLabel: a second exact tie pair stays symmetric post-fix", () => {
  // mark=8, level=5 -> dollars=-3.00, pct=-37.5%
  assert.equal(trimLadderDistanceLabel(5, 8), " · -3.00 / -38% away");
  // mark=8, level=11 -> dollars=+3.00, pct=+37.5%
  assert.equal(trimLadderDistanceLabel(11, 8), " · +3.00 / +38% away");
});

test("trimLadderDistanceLabel: ordinary non-tie values round as expected", () => {
  assert.equal(trimLadderDistanceLabel(112.4, 100), " · +12.40 / +12% away");
  assert.equal(trimLadderDistanceLabel(87.6, 100), " · -12.40 / -12% away");
});

test("trimLadderDistanceLabel: null level/mark and non-positive mark are handled", () => {
  assert.equal(trimLadderDistanceLabel(null, 100), "");
  assert.equal(trimLadderDistanceLabel(100, null), "");
  // mark <= 0 -> pct leg omitted entirely (can't divide), dollars leg still shown
  assert.equal(trimLadderDistanceLabel(5, 0), " · +5.00 away");
});
