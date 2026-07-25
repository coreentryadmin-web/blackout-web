// WS-10 — executable-side P&L lanes (bid/ask, not mid). Pure tests: the executable math
// leaf (marks-math.ts) + the executable grader (plan.ts gradePlanExecutableFromBars). No
// providers, no DB, no clock — every number is pinned deterministically.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  executablePnlPct,
  executionTaxBps,
  pinnedLivePnlPct,
  zeroDteExecutableEntry,
  zeroDteExecutableExit,
  zeroDteHalfSpreadFrac,
  ZERODTE_DEFAULT_HALF_SPREAD_FRAC,
} from "./marks-math";
import {
  gradePlanExecutableFromBars,
  gradePlanFromBars,
  reconstructTrimScaleExecutableFromBars,
  type PlanBar,
  type TrimScaleSpec,
} from "./plan";

// A summer-EDT (UTC-4) session: 14:00Z = 10:00 ET (600 min < the 15:30 time stop), so these
// bars are firmly inside the grading window and after the flag.
const T = (hhmm: string): number => Date.parse(`2026-07-10T${hhmm}:00Z`);

// ── Pure executable math ─────────────────────────────────────────────────────────────

test("zeroDteHalfSpreadFrac: (ask−bid)/(ask+bid); one-sided/crossed → null (default frac used)", () => {
  assert.ok(Math.abs(zeroDteHalfSpreadFrac(0.9, 1.1)! - 0.1) < 1e-9); // 0.2 / 2.0 (float dust)
  assert.equal(zeroDteHalfSpreadFrac(1.0, 1.0), 0); // locked but valid → zero tax
  assert.equal(zeroDteHalfSpreadFrac(null, 1.1), null); // one-sided
  assert.equal(zeroDteHalfSpreadFrac(1.2, 1.0), null); // crossed (ask < bid)
  assert.equal(zeroDteHalfSpreadFrac(0, 0), null); // no book
});

test("executable entry=ask (mid×(1+f)), exit=bid (mid×(1−f)); exit floored at 0", () => {
  assert.equal(zeroDteExecutableEntry(1.0, 0.1), 1.1);
  assert.equal(zeroDteExecutableExit(1.0, 0.1), 0.9);
  assert.equal(zeroDteExecutableExit(1.0, 1.5), 0); // >100% frac can't make a negative bid
  assert.equal(zeroDteExecutableEntry(null, 0.1), null);
});

test("executablePnlPct: (exit bid − entry ask)/entry ask", () => {
  // Enter at ask 1.10, exit at bid 0.90 → a −18.18% round trip even though the MID never moved.
  assert.equal(executablePnlPct(1.1, 0.9), -18.18);
  assert.equal(executablePnlPct(null, 0.9), null);
  assert.equal(executablePnlPct(1.1, null), null);
});

test("executionTaxBps = (mid P&L − executable P&L) × 100 (percentage points → bps)", () => {
  assert.equal(executionTaxBps(100, 81.82), 1818);
  assert.equal(executionTaxBps(-44, -54.5), 1050);
  assert.equal(executionTaxBps(50, null), null);
});

// ── REQUIRED TEST 1: a wide-spread contract's executable exit return < its mid return ──
test("WS-10 #1: wide-spread winner — executable target return is BELOW the mid target return (the tax is real)", () => {
  const flag = T("13:59");
  // The option runs to a 2.3 trade high — the mid grade doubles at +100%. With a 10% half-
  // spread the bid only reaches 2.07, still ≥ the 2.0 target, so the executable grade ALSO
  // doubles — but pays the ask to enter (1.10) and sells the bid at the target, so it books
  // LESS. Same outcome label, strictly smaller return: the execution tax the mid lane hid.
  const bars: PlanBar[] = [{ t: T("14:00"), h: 2.3, l: 1.0, c: 2.2 }];
  const mid = gradePlanFromBars(bars, 1.0, flag);
  const exec = gradePlanExecutableFromBars(bars, 1.0, flag, 0.1);
  assert.equal(mid.outcome, "doubled");
  assert.equal(mid.pnl_pct, 100);
  assert.equal(exec.outcome, "doubled");
  assert.equal(exec.pnl_pct, 81.82); // (2.0 − 1.1)/1.1
  assert.ok(exec.pnl_pct! < mid.pnl_pct!, "executable return must be below the mid return");
});

// ── REQUIRED TEST 2: the stop triggers on the BID, not the mid ─────────────────────────
test("WS-10 #2: stop LATCHES ON THE BID — executable stops where the mid grade only time-stops", () => {
  const flag = T("13:59");
  // The trade low bottoms at 0.54 — ABOVE the 0.50 stop level, so the MID grade never stops
  // (it rides to a green-of-red time stop). But the member SELLS INTO THE BID: at a 10% half-
  // spread the bid low is 0.54×0.9 = 0.486, which crosses the 0.50 stop. The executable lane
  // must book a STOP the mid lane is blind to — the negative-skew tail WS-10 exists to expose.
  const bars: PlanBar[] = [
    { t: T("14:00"), h: 0.6, l: 0.54, c: 0.56 },
    { t: T("14:05"), h: 0.58, l: 0.55, c: 0.55 },
  ];
  const mid = gradePlanFromBars(bars, 1.0, flag);
  const exec = gradePlanExecutableFromBars(bars, 1.0, flag, 0.1);
  assert.equal(mid.outcome, "time_stop"); // mid never touched 0.50
  assert.equal(exec.outcome, "stopped"); // bid did
  assert.equal(exec.pnl_pct, -54.55); // (0.50 − 1.1)/1.1
  assert.ok(exec.pnl_pct! < mid.pnl_pct!, "the bid-triggered stop is worse than the mid time-stop");
});

test("WS-10: a locked/zero-spread book (f=0) reproduces the mid grade exactly (no phantom tax)", () => {
  const flag = T("13:59");
  const bars: PlanBar[] = [{ t: T("14:00"), h: 2.1, l: 0.9, c: 2.0 }];
  const mid = gradePlanFromBars(bars, 1.0, flag);
  const exec = gradePlanExecutableFromBars(bars, 1.0, flag, 0);
  assert.deepEqual(exec, mid);
});

test("WS-10: default half-spread frac is a conservative, positive floor", () => {
  assert.ok(ZERODTE_DEFAULT_HALF_SPREAD_FRAC > 0 && ZERODTE_DEFAULT_HALF_SPREAD_FRAC < 0.5);
  // Sanity: the mid pinned-P&L leaf still marks on the raw mark (unchanged monitoring lane).
  assert.equal(pinnedLivePnlPct(1.0, 1.5), 50);
});

// ── WS-11: TRIM-SCALE reconstruction in the mechanical grader ──────────────────────────
// The engine runs a PARTIAL scale-out (⅓@+25%, ⅓@+50%, run the last ⅓), but the single-walk
// grader exits the WHOLE position once — grading a different strategy than the one traded.
// reconstructTrimScaleExecutableFromBars replays the frozen ladder leg-by-leg, executable-priced.

/** The neutral E5 ladder as the frozen snapshot resolves it: ⅓@+25%, ⅓@+50%, runner ⅓. */
const NEUTRAL_TRIM: TrimScaleSpec = {
  trim_levels: [
    { trigger_pct: 25, fraction: 1 / 3 },
    { trigger_pct: 50, fraction: 1 / 3 },
  ],
  runner_fraction: 1 / 3,
};

// ── REQUIRED TEST 1: trims TWICE then trails → three legs, ⅓/⅓/⅓, executable-priced, blended ──
test("WS-11 #1: trims twice then trails — reconstructs THREE legs (⅓/⅓/⅓), executable-priced, blended P&L", () => {
  const flag = T("13:59");
  // entry 1.0, f=0.1 → ask 1.10. trim1 level 1.25 (bidHigh≥1.25 ⇒ trade h≥1.389), trim2 level 1.50
  // (trade h≥1.667). The runner never tags the +100% target (2.0) or the −50% stop (0.5); it
  // time-stops at the last close bid.
  const bars: PlanBar[] = [
    { t: T("14:00"), h: 1.4, l: 1.2, c: 1.35 }, // bidHigh 1.26 ≥ 1.25 → bank trim1
    { t: T("14:05"), h: 1.7, l: 1.5, c: 1.6 }, // bidHigh 1.53 ≥ 1.50 → bank trim2
    { t: T("14:10"), h: 1.6, l: 1.5, c: 1.55 }, // runner trails; last close bid = 1.395
  ];
  const out = reconstructTrimScaleExecutableFromBars(bars, 1.0, flag, 0.1, NEUTRAL_TRIM);
  assert.equal(out.outcome, "time_stop");
  assert.ok(out.tranches && out.tranches.length === 3, "three legs: two trims + the runner");
  const [t1, t2, t3] = out.tranches!;
  // Fractions: ⅓ / ⅓ / ⅓ of the ORIGINAL position.
  for (const leg of out.tranches!) assert.ok(Math.abs(leg.fraction - 1 / 3) < 1e-9);
  // Executable leg returns: each leg sells the BID at its level against the 1.10 ask entry.
  assert.equal(t1!.exit_reason, "trim_scale_first");
  assert.equal(t1!.exit_pnl_pct, 13.64); // (1.25 − 1.1)/1.1
  assert.equal(t1!.at_et, "10:00");
  assert.equal(t2!.exit_reason, "trim_scale_second");
  assert.equal(t2!.exit_pnl_pct, 36.36); // (1.50 − 1.1)/1.1
  assert.equal(t2!.at_et, "10:05");
  assert.equal(t3!.exit_reason, "time_stop");
  assert.equal(t3!.exit_pnl_pct, 26.82); // (1.395 − 1.1)/1.1
  assert.equal(t3!.at_et, "10:10");
  // Blended P&L is the fraction-weighted sum of the leg returns.
  const blend = t1!.fraction * t1!.exit_pnl_pct + t2!.fraction * t2!.exit_pnl_pct + t3!.fraction * t3!.exit_pnl_pct;
  assert.ok(Math.abs(out.pnl_pct! - Math.round(blend * 100) / 100) < 1e-9);
  assert.equal(out.pnl_pct, 25.61);
  // FAIL-BEFORE: the single-walk executable grade on the SAME bars is ONE exit (doubled? no — it
  // time-stops the whole position at the last close bid), a DIFFERENT number than the partial
  // path — proof the old grader graded a different strategy than the engine runs.
  const single = gradePlanExecutableFromBars(bars, 1.0, flag, 0.1);
  assert.equal(single.tranches, undefined, "the single walk never reconstructs partials");
  assert.notEqual(single.pnl_pct, out.pnl_pct);
});

test("WS-11: a trims-then-DOUBLES runner books the last third at the +100% target", () => {
  const flag = T("13:59");
  const bars: PlanBar[] = [
    { t: T("14:00"), h: 1.4, l: 1.2, c: 1.35 }, // trim1 @1.25
    { t: T("14:05"), h: 1.7, l: 1.5, c: 1.6 }, // trim2 @1.50
    { t: T("14:10"), h: 2.3, l: 1.6, c: 2.2 }, // bidHigh 2.07 ≥ 2.0 → runner doubles
  ];
  const out = reconstructTrimScaleExecutableFromBars(bars, 1.0, flag, 0.1, NEUTRAL_TRIM);
  assert.equal(out.outcome, "doubled");
  assert.equal(out.tranches!.length, 3);
  assert.equal(out.tranches![2]!.exit_reason, "doubled");
  assert.equal(out.tranches![2]!.exit_pnl_pct, 81.82); // (2.0 − 1.1)/1.1
});

test("WS-11: a same-bar stop BEFORE any trim closes the whole position at the stop (single leg = single walk)", () => {
  const flag = T("13:59");
  // The bid low crosses the 0.50 stop on the first bar, before any trim arms → one stopped leg.
  const bars: PlanBar[] = [{ t: T("14:00"), h: 0.7, l: 0.5, c: 0.55 }];
  const out = reconstructTrimScaleExecutableFromBars(bars, 1.0, flag, 0.1, NEUTRAL_TRIM);
  assert.equal(out.outcome, "stopped");
  assert.equal(out.tranches!.length, 1);
  assert.ok(Math.abs(out.tranches![0]!.fraction - 1) < 1e-9, "the whole position exits at the stop");
  // Same blended P&L as the single executable walk when nothing trimmed first.
  const single = gradePlanExecutableFromBars(bars, 1.0, flag, 0.1);
  assert.equal(out.pnl_pct, single.pnl_pct);
});

test("WS-11: an EMPTY ladder defers to the single walk (degenerate snapshot never drops to ungradeable)", () => {
  const flag = T("13:59");
  const bars: PlanBar[] = [{ t: T("14:00"), h: 2.3, l: 1.0, c: 2.2 }];
  const empty: TrimScaleSpec = { trim_levels: [], runner_fraction: 1 };
  const out = reconstructTrimScaleExecutableFromBars(bars, 1.0, flag, 0.1, empty);
  assert.deepEqual(out, gradePlanExecutableFromBars(bars, 1.0, flag, 0.1));
});

test("WS-11: no post-flag bars → ungradeable (never a fabricated fill)", () => {
  const flag = T("14:30");
  const bars: PlanBar[] = [{ t: T("14:00"), h: 1.4, l: 1.2, c: 1.35 }]; // before the flag
  const out = reconstructTrimScaleExecutableFromBars(bars, 1.0, flag, 0.1, NEUTRAL_TRIM);
  assert.equal(out.outcome, "ungradeable");
  assert.equal(out.pnl_pct, null);
});
