// Terminal v2 pure derivations — trim ladder fired-state, the 15:30 time-stop clock, and
// the executable fill. No providers, no DB, no clock: every number is pinned.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildTerminalExitLadder,
  executableFill,
  timeStopClock,
  RTH_OPEN_ET_MINUTES,
  type TerminalPolicyInput,
} from "./terminal-ladder.ts";
import { PLAN_RULES } from "./plan.ts";
import { buildResolvedExitPolicy } from "./strategy-version.ts";

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
  assert.equal(e.pnl_pct, 20); // (2.4-2.0)/2.0
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
});

test("executable: crossed book is rejected (never a negative-spread fill)", () => {
  const crossed = executableFill(2.7, 2.6, 2.0); // bid > ask
  assert.equal(crossed.mid, null);
  assert.equal(crossed.fill, null);
});
