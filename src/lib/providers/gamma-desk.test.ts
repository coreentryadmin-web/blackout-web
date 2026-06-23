import { test } from "node:test";
import assert from "node:assert/strict";
// gamma-desk.ts has ZERO imports (no @/, no Next, no Redis) -> resolves cleanly
// under tsx --test. Both functions are pure/deterministic.
import { analyzeStrikeGexRows, computeGammaFlip } from "./gamma-desk";

test("balanced net-0 strike (callG=-putG) SURVIVES the filter", () => {
  const out = analyzeStrikeGexRows([
    { strike: 100, call_gamma_oi: 10, put_gamma_oi: 0 },
    { strike: 105, call_gamma_oi: 5, put_gamma_oi: -5 },
    { strike: 110, call_gamma_oi: 0, put_gamma_oi: -10 },
  ]);
  const balanced = out.ranked_levels.find((l) => l.strike === 105);
  assert.ok(balanced, "balanced strike 105 must not be dropped");
  assert.equal(balanced!.net_gex, 0);
});

test("true 0/0 empty strike is DROPPED", () => {
  const out = analyzeStrikeGexRows([
    { strike: 100, call_gamma_oi: 10, put_gamma_oi: 0 },
    { strike: 105, call_gamma_oi: 0, put_gamma_oi: 0 },
  ]);
  assert.equal(out.ranked_levels.find((l) => l.strike === 105), undefined);
});

test("balanced net-0 row is output-neutral for computeGammaFlip", () => {
  // A net-0 row adds 0 to the cumulative sum and can never be the selected flip
  // anchor: for [100:+10, 105:0, 110:-10] @ spot 106 the cum is 10 through 105
  // then hits 0 at 110 -> flip is 110. Dropping the balanced 105 row yields the
  // SAME flip (the real regression guard).
  const withBalanced = computeGammaFlip(
    [
      { strike: 100, net_gex: 10 },
      { strike: 105, net_gex: 0 },
      { strike: 110, net_gex: -10 },
    ],
    106
  );
  const withoutBalanced = computeGammaFlip(
    [
      { strike: 100, net_gex: 10 },
      { strike: 110, net_gex: -10 },
    ],
    106
  );
  assert.equal(withBalanced, 110);
  assert.equal(withBalanced, withoutBalanced);
});

test("sign-change interpolation unaffected (cumulative crosses zero)", () => {
  // cum: 8 at 100, then 8 + (-12) = -4 at 110 -> crosses zero -> interpolate
  // flip = 100 + (8/12)*10 = 106.67, strictly within (100, 110).
  const flip = computeGammaFlip(
    [
      { strike: 100, net_gex: 8 },
      { strike: 110, net_gex: -12 },
    ],
    104
  );
  assert.ok(flip !== null && flip > 100 && flip < 110, "flip interpolates within (100,110)");
});

test("empty / insufficient input", () => {
  const out = analyzeStrikeGexRows([]);
  assert.deepEqual(out.ranked_levels, []);
  assert.equal(out.gex_king_strike, null);
  assert.equal(computeGammaFlip([], 100), null);
});
