import test from "node:test";
import assert from "node:assert/strict";
import { signPct } from "./PlayTerminal";

// REGRESSION: `signPct` rounded with plain `Math.round(n)`, which ties toward +Infinity
// (`Math.round(-2.5) === -2` but `Math.round(2.5) === 3`) — a sign-biased asymmetry. A losing
// position's Peak/Trough chip (TradeOutcomePanel's `nh-deck-neg` row) or scorecard-hint average
// sitting exactly on a half-percent tie therefore rendered a SMALLER magnitude than the
// mirror-image gain would for the identical distance from zero. Same bug class already fixed in
// `fmt-money.ts`'s `fmtPct` (2026-10-26), `round-floats.ts`, and
// `thermal/lib/gex-heatmap/shift-math.ts`'s `fmtShiftPercentForStrike` — this Night Hawk
// command-deck sibling was an independent, un-migrated instance of the same paste.
test("PlayTerminal signPct: equal-magnitude positive/negative ties render the SAME magnitude", () => {
  assert.equal(signPct(2.5), "+3%");
  assert.equal(signPct(-2.5), "-3%"); // was "-2%" pre-fix — smaller magnitude than the +3% mirror
  assert.equal(signPct(0.5), "+1%");
  assert.equal(signPct(-0.5), "-1%"); // was "-0%" pre-fix
});

test("PlayTerminal signPct: ordinary non-tie values round as expected", () => {
  assert.equal(signPct(12.4), "+12%");
  assert.equal(signPct(-12.4), "-12%");
  assert.equal(signPct(12.6), "+13%");
  assert.equal(signPct(-12.6), "-13%");
});

test("PlayTerminal signPct: zero and null/undefined", () => {
  assert.equal(signPct(0), "0%");
  assert.equal(signPct(null), "—");
  assert.equal(signPct(undefined), "—");
});
