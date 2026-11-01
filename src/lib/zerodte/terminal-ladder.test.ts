// Terminal v2 pure derivations — trim ladder fired-state, the 15:30 time-stop clock, and
// the executable fill. No providers, no DB, no clock: every number is pinned.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildTerminalExitLadder,
  executableFill,
  timeStopClock,
  hasScaledOut,
  runnerTrailingStopPremium,
  RTH_OPEN_ET_MINUTES,
  type TerminalPolicyInput,
} from "./terminal-ladder.ts";
import { PLAN_RULES } from "./plan.ts";
import { buildResolvedExitPolicy } from "./strategy-version.ts";
import { fmtPct } from "../fmt-money.ts";

const TRIM_SCALE: TerminalPolicyInput = {
  policy: "trim_scale",
  hard_stop_pct: -50,
  target_pct: 100,
  trim_levels: [
    { trigger_pct: 25, fraction: 1 / 3 },
    { trigger_pct: 50, fraction: 1 / 3 },
  ],
  runner_fraction: 1 / 3,
  time_stop_et: "15:50",
};

test("ladder: prices each trim level off entry and stop/target rails", () => {
  const l = buildTerminalExitLadder(TRIM_SCALE, 2.0, 2.0);
  assert.equal(l.policy, "trim_scale");
  assert.equal(l.trim_levels[0]!.premium, 2.5); // 2.0 × 1.25
  assert.equal(l.trim_levels[1]!.premium, 3.0); // 2.0 × 1.50
  assert.equal(l.stop_premium, 1.0); // 2.0 × 0.50
  assert.equal(l.target_premium, 4.0); // 2.0 × 2.00
});

test("ladder: fired-state derives from the latched peak reaching each level", () => {
  // Peak reached +30% → first trim (+25% = 2.5) fired, second (+50% = 3.0) pending.
  const l = buildTerminalExitLadder(TRIM_SCALE, 2.0, 2.6);
  assert.equal(l.trim_levels[0]!.fired, true);
  assert.equal(l.trim_levels[1]!.fired, false);
  // Peak exactly at the level counts as fired (>=).
  assert.equal(buildTerminalExitLadder(TRIM_SCALE, 2.0, 3.0).trim_levels[1]!.fired, true);
  // No peak / below entry → nothing fired.
  const cold = buildTerminalExitLadder(TRIM_SCALE, 2.0, 1.9);
  assert.equal(cold.trim_levels[0]!.fired, false);
  assert.equal(cold.trim_levels[1]!.fired, false);
});

test("ladder: null entry leaves premiums null and nothing fired (never fabricated)", () => {
  const l = buildTerminalExitLadder(TRIM_SCALE, null, 5.0);
  assert.equal(l.trim_levels[0]!.premium, null);
  assert.equal(l.trim_levels[0]!.fired, false);
  assert.equal(l.stop_premium, null);
  assert.equal(l.target_premium, null);
});

test("ladder: the SHIPPED trim_scale ResolvedExitPolicy resolves to a real ⅓/⅓ ladder", () => {
  // Guards against the trim ladder drifting away from the frozen strategy version.
  const policy = buildResolvedExitPolicy("trim_scale");
  const l = buildTerminalExitLadder(policy, 3.0, 3.0);
  assert.equal(l.policy, "trim_scale");
  assert.ok(l.trim_levels.length >= 2, "trim_scale has >=2 profit tranches");
  assert.ok(l.trim_levels[0]!.trigger_pct > 0 && l.trim_levels[0]!.trigger_pct < 100);
  assert.equal(l.time_stop_et, "15:50");
});

test("ladder: ratchet policy stays a single-trim policy (legacy render unchanged)", () => {
  const policy = buildResolvedExitPolicy("ratchet");
  const l = buildTerminalExitLadder(policy, 2.0, 2.0);
  assert.equal(l.policy, "ratchet");
  assert.equal(l.trim_levels.length, 1); // the single +100% half-trim
});

// BUG FIX (2026-10-21, Ask Largo 5-engine cycle, live repro MRNA TRIM/positionId 1958): a brief
// rendering `stop_premium` post-scale was stating a dead trigger as live — deriveScaleOutAction/
// computeScaleOutTriggerInfo (scale-out.ts) permanently disable the pre-scale hard stop once any
// trim has fired. hasScaledOut/runnerTrailingStopPremium let a renderer ask whether the ladder's
// own stop_premium is still live and, if not, what the real governing floor is now.
test("hasScaledOut: false before any trim fires, true once one has", () => {
  const cold = buildTerminalExitLadder(TRIM_SCALE, 2.0, 1.9);
  assert.equal(hasScaledOut(cold), false);
  const scaled = buildTerminalExitLadder(TRIM_SCALE, 2.0, 2.6); // first trim (+25%=2.5) fired
  assert.equal(hasScaledOut(scaled), true);
});

test("runnerTrailingStopPremium: peakPremium × SCALE_OUT_RULES.trail_from_peak (0.5)", () => {
  // Live MRNA repro: entry $6.49, peak +103.4% → peak premium ≈ $13.21 → real floor ≈ $6.605.
  assert.equal(runnerTrailingStopPremium(13.21), 6.61); // round2(13.21 * 0.5)
  assert.equal(runnerTrailingStopPremium(null), null);
  assert.equal(runnerTrailingStopPremium(0), null);
  assert.equal(runnerTrailingStopPremium(Number.NaN), null);
});

test("clock: minutes remaining + label + elapsed fraction to 15:50", () => {
  const stop = PLAN_RULES.time_stop_et_minutes; // 950
  const c = timeStopClock(RTH_OPEN_ET_MINUTES); // at the open
  assert.equal(c.minutes_remaining, stop - RTH_OPEN_ET_MINUTES); // 380
  assert.equal(c.elapsed_frac, 0);
  assert.equal(c.past_time_stop, false);

  const mid = timeStopClock(12 * 60 + 30); // 12:30 → 3h20 left to 15:50
  assert.equal(mid.minutes_remaining, 200);
  assert.equal(mid.label, "3:20");
  assert.ok(Math.abs(mid.elapsed_frac - 180 / 380) < 1e-9);
});

test("clock: at/after the time-stop clamps to 0 remaining / full decay", () => {
  const c = timeStopClock(PLAN_RULES.time_stop_et_minutes + 5);
  assert.equal(c.minutes_remaining, 0);
  assert.equal(c.label, "0:00");
  assert.equal(c.elapsed_frac, 1);
  assert.equal(c.past_time_stop, true);
});

// Bug found 2026-08-26: past_time_stop used `>=`, so the displayed "TIME STOP" flag lit
// up a full minute before derivePlayStatus's (plan.ts) own boundary, which is strict `>`
// (the stop minute itself is still in the window — plan.test.ts pins this as inclusive).
test("clock: past_time_stop matches derivePlayStatus's own boundary — AT the stop minute is NOT past it", () => {
  const stop = PLAN_RULES.time_stop_et_minutes;
  assert.equal(timeStopClock(stop).past_time_stop, false, "the stop minute itself is still in the window");
  assert.equal(timeStopClock(stop + 1).past_time_stop, true);
});

test("executable: long sells into the BID, not the mid", () => {
  const e = executableFill(2.4, 2.6, 2.0); // mid 2.5, bid 2.4
  assert.equal(e.mid, 2.5);
  assert.equal(e.fill, 2.4);
  // pnl_pct is now the RAW unrounded ratio (see the 2026-11-01 bug-fix test below) — IEEE-754
  // division of this exact pair lands a hair off a clean 20 (19.999999999999996), which is why
  // this asserts a tight tolerance rather than strict equality; the earlier strict `=== 20` only
  // held because the function used to round internally.
  assert.ok(Math.abs(e.pnl_pct! - 20) < 1e-9, `expected ~20, got ${e.pnl_pct}`); // (2.4-2.0)/2.0
});

test("executable: one-sided / no book → mid only, no fake fill", () => {
  const oneSided = executableFill(null, 2.6, 2.0);
  assert.equal(oneSided.mid, null);
  assert.equal(oneSided.fill, null);
  assert.equal(oneSided.pnl_pct, null);
  // zero bid (deep-OTM, no buyer) → mid may exist but no honest exit fill.
  const zeroBid = executableFill(0, 0.1, 2.0);
  assert.equal(zeroBid.fill, null);
  assert.equal(zeroBid.pnl_pct, null);
  // BUG FIX (Ask Largo standing mandate, 2026-10-25, live repro EXPE): `fill`/`pnl_pct` staying
  // null for a confirmed zero bid is INTENTIONAL and unchanged by this fix (asserted above) — but a
  // caller must be able to tell this case apart from "no book at all" (asserted just below), which
  // the one-sided case above does NOT set.
  assert.equal(zeroBid.bidConfirmedZero, true, "a real two-sided book with bid===0 is a CONFIRMED zero, not an absence");
  assert.equal(oneSided.bidConfirmedZero, false, "no book at all must not be confused with a confirmed zero bid");
});

test("executable: crossed book is rejected (never a negative-spread fill)", () => {
  const crossed = executableFill(2.7, 2.6, 2.0); // bid > ask
  assert.equal(crossed.mid, null);
  assert.equal(crossed.fill, null);
});

// BUG FIX (Ask Largo standing mandate, 2026-11-01, live repro QXO SWING positionId 2299):
// `pnl_pct` used to be PRE-ROUNDED to 2dp-of-percent right here
// (Math.round(((fill-entryPremium)/entryPremium)*10000)/100) before ANY caller ever formatted it
// for display. adapters.ts's troughDisplay/peakDisplay compute the IDENTICAL kind of ratio with a
// SINGLE round straight to 1dp; this pre-rounded value then got a SECOND round (also to 1dp) from
// whichever renderer displayed it (`fmtPct` in the swing/LEAPS play-brief narrative, `toFixed(1)`
// in the Command Deck's LEAPS PnlPanel). Two successive roundings of the same fact can disagree
// with a single rounding of it whenever the first round lands exactly on the second round's tie
// boundary — exactly what happened for entry $0.22 / bid $0.10: the raw ratio is -54.545...%,
// which single-rounds to -54.5% (the Trough line's own math, adapters.ts), but pre-rounding to 2dp
// first lands on the EXACT tie -54.55, which `fmtPct`'s ties-away-from-zero algorithm then pushes
// to -54.6% — one tenth of a point off the mathematically identical fact, rendered a few lines
// apart in the SAME play-brief markdown (play-brief.ts's "Trough" vs "Exec P&L" lines). Fixed by
// not pre-rounding `pnl_pct` here (Largo Product Contract C9: round exactly once, at the final
// display boundary) — `mid`/`fill` still round to the cent (a legitimate, DIFFERENT boundary: NBBO
// premiums are penny-quoted), but `pnl_pct` is now the raw ratio, rounded only once by whatever
// finally renders it.
test("executable: pnl_pct is NOT pre-rounded — a single final round now agrees with a direct single-rounded computation of the IDENTICAL ratio (live repro QXO positionId 2299: entry $0.22, bid $0.10, ask $0.20)", () => {
  const entryPremium = 0.22;
  const bid = 0.10;
  const ask = 0.20;
  const e = executableFill(bid, ask, entryPremium);
  assert.equal(e.fill, 0.10);
  // The raw ratio, unrounded — NOT the old pre-rounded -54.55 (which sits exactly on fmtPct's tie
  // boundary and is what produced the live -54.6% mismatch).
  assert.ok(
    Math.abs(e.pnl_pct! - ((0.10 - 0.22) / 0.22) * 100) < 1e-9,
    `expected the raw unrounded ratio, got ${e.pnl_pct}`
  );
  assert.notEqual(e.pnl_pct, -54.55, "must not still be pre-rounded to the exact tie value");
  // adapters.ts's troughDisplay/peakDisplay formula: a single round straight from the raw ratio.
  const singleRoundedDirectly = Math.round(((bid / entryPremium - 1) * 100) * 10) / 10;
  assert.equal(singleRoundedDirectly, -54.5, "sanity: this is the live Trough line's own number");
  // The ONE remaining round (fmtPct, at the swing play-brief's display boundary) must now land on
  // the SAME -54.5% the Trough line renders for the identical underlying fact — this is the exact
  // live mismatch (Trough "-54.5%" vs Exec P&L "-54.6%") the bug report reproduced.
  assert.equal(fmtPct(e.pnl_pct), "-54.5%");
});
