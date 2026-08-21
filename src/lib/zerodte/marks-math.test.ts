// WS-10 — executable-side P&L lanes (bid/ask, not mid). Pure tests: the executable math
// leaf (marks-math.ts) + the executable grader (plan.ts gradePlanExecutableFromBars). No
// providers, no DB, no clock — every number is pinned deterministically.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  advancePlayLatch,
  closedPnlDisplay,
  closedStopReason,
  condorSellerPnlPct,
  executablePnlPct,
  executionTaxBps,
  isZeroDteMarkStale,
  latchPremiumBounds,
  ledgerDisplayPnlPct,
  directionalClosedDisplayPnlPct,
  livePnlPctFor,
  pinnedLivePnlPct,
  reconcileLedgerLivePnlPct,
  resolveZeroDteMark,
  zeroDteExecutableEntry,
  zeroDteExecutableExit,
  zeroDteHalfSpreadFrac,
  zeroDteMidOf,
  ZERODTE_DEFAULT_HALF_SPREAD_FRAC,
  ZERODTE_MARK_STALE_MS,
} from "./marks-math";
import {
  gradePlanExecutableFromBars,
  gradePlanFromBars,
  PLAN_RULES,
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

// ════════════════════════════════════════════════════════════════════════════════════
// MONITORING LANE — mark resolution, staleness, ledger P&L, latched lifecycle. Pure,
// deterministic; every displayed number derived here has exactly one source of truth.
// ════════════════════════════════════════════════════════════════════════════════════

// ── zeroDteMidOf / resolveZeroDteMark: mid > last > none, dayClose never a live mark ──
test("zeroDteMidOf: valid two-sided quote → midpoint (4dp); one-sided/negative book → null", () => {
  assert.equal(zeroDteMidOf(0.9, 1.1), 1.0);
  assert.equal(zeroDteMidOf(0, 0.4), 0.2); // bid 0 is legal for deep-OTM (ask>0 is the gate)
  assert.equal(zeroDteMidOf(null, 1.1), null);
  assert.equal(zeroDteMidOf(1.0, null), null);
  assert.equal(zeroDteMidOf(1.0, 0), null); // ask must be > 0
  assert.equal(zeroDteMidOf(1.23456, 1.23458), 1.2346); // rounded to 4dp
});

test("resolveZeroDteMark: MID when a two-sided quote exists (provenance 'mid')", () => {
  assert.deepEqual(resolveZeroDteMark(0.9, 1.1, 5.0), { mark: 1.0, source: "mid" });
});

test("resolveZeroDteMark: falls back to LAST (flagged) only when no usable mid", () => {
  assert.deepEqual(resolveZeroDteMark(null, null, 3.3), { mark: 3.3, source: "last" });
  assert.deepEqual(resolveZeroDteMark(1.0, null, 3.3), { mark: 3.3, source: "last" }); // one-sided → no mid
});

test("resolveZeroDteMark: no usable mid AND no positive last → none (never a fabricated mark)", () => {
  assert.deepEqual(resolveZeroDteMark(null, null, null), { mark: null, source: "none" });
  assert.deepEqual(resolveZeroDteMark(null, null, 0), { mark: null, source: "none" }); // last ≤ 0 rejected
  assert.deepEqual(resolveZeroDteMark(0, 0, null), { mark: null, source: "none" }); // no book at all
});

test("resolveZeroDteMark: a mid that computes to 0 is NOT a mark (dead book) → falls through to last", () => {
  // bid 0, ask 0 → zeroDteMidOf null; but a mid of exactly 0 (impossible here since ask>0) would be
  // rejected by the `mid > 0` guard, so a real last trade wins.
  assert.deepEqual(resolveZeroDteMark(0, 0, 2.0), { mark: 2.0, source: "last" });
});

// ── pinnedLivePnlPct: THE P&L formula, always vs the pinned entry ─────────────────────
test("pinnedLivePnlPct: (mark − entry)/entry ×100, 2dp; guards on bad entry/mark", () => {
  assert.equal(pinnedLivePnlPct(4.2, 6.9), 64.29);
  assert.equal(pinnedLivePnlPct(1.0, 0.5), -50);
  assert.equal(pinnedLivePnlPct(1.0, 2.0), 100);
  assert.equal(pinnedLivePnlPct(null, 2.0), null);
  assert.equal(pinnedLivePnlPct(0, 2.0), null); // entry ≤ 0
  assert.equal(pinnedLivePnlPct(-1, 2.0), null);
  assert.equal(pinnedLivePnlPct(1.0, null), null);
});

// ── isZeroDteMarkStale: boundary at EXACTLY ZERODTE_MARK_STALE_MS ──────────────────────
test("isZeroDteMarkStale: fresh under the bound, stale strictly over it (boundary at =ms is FRESH)", () => {
  const now = 1_000_000;
  assert.equal(ZERODTE_MARK_STALE_MS, 5_000);
  assert.equal(isZeroDteMarkStale(now - 4_999, now), false); // just fresh
  assert.equal(isZeroDteMarkStale(now - ZERODTE_MARK_STALE_MS, now), false); // exactly the bound → NOT stale (strict >)
  assert.equal(isZeroDteMarkStale(now - (ZERODTE_MARK_STALE_MS + 1), now), true); // 1ms over → stale
});

test("isZeroDteMarkStale: a missing/zero timestamp is ALWAYS stale (unknown age ≠ fresh)", () => {
  assert.equal(isZeroDteMarkStale(0, 1_000_000), true);
  assert.equal(isZeroDteMarkStale(-5, 1_000_000), true);
});

test("isZeroDteMarkStale: custom bound is honored", () => {
  const now = 1_000_000;
  assert.equal(isZeroDteMarkStale(now - 900, now, 1_000), false);
  assert.equal(isZeroDteMarkStale(now - 1_001, now, 1_000), true);
});

// ── closedStopReason: a stopped CLOSED row books the stop P&L, not a frozen last_mark ─
test("closedStopReason: CLOSED with trough ≤ stop and no prior target → 'stopped'", () => {
  // entry 1.0 → stop 0.5, target 2.0. trough 0.4 crossed the stop; peak never reached target.
  assert.equal(closedStopReason({ status: "CLOSED", entry_premium: 1.0, peak_premium: 1.3, trough_premium: 0.4 }), "stopped");
  assert.equal(closedStopReason({ status: "CLOSED", entry_premium: 1.0, peak_premium: 1.3, trough_premium: 0.5 }), "stopped"); // == stop boundary
});

test("closedStopReason: a peak that tagged the target FIRST makes it a sticky TRIM, never 'stopped'", () => {
  // Even though trough later crossed the stop, peak ≥ target (2.0) means the trim was sticky first.
  assert.equal(closedStopReason({ status: "CLOSED", entry_premium: 1.0, peak_premium: 2.0, trough_premium: 0.3 }), null);
});

test("closedStopReason: non-CLOSED, missing entry, or trough above the stop → null (mark-derived P&L)", () => {
  assert.equal(closedStopReason({ status: "OPEN", entry_premium: 1.0, peak_premium: 1.0, trough_premium: 0.3 }), null);
  assert.equal(closedStopReason({ status: "CLOSED", entry_premium: null, peak_premium: 1.0, trough_premium: 0.3 }), null);
  assert.equal(closedStopReason({ status: "CLOSED", entry_premium: 0, peak_premium: 1.0, trough_premium: 0.3 }), null);
  assert.equal(closedStopReason({ status: "CLOSED", entry_premium: 1.0, peak_premium: 1.3, trough_premium: 0.51 }), null); // above stop
  assert.equal(closedStopReason({ status: "CLOSED", entry_premium: 1.0, peak_premium: null, trough_premium: null }), null); // time-stop close
});

// ── ledgerDisplayPnlPct: stopped uses trim-scale blend when peak armed tranches ────────
test("ledgerDisplayPnlPct: a stopped row with no trim tranches armed pins to PLAN_RULES.stop_pct", () => {
  const row = { status: "CLOSED", entry_premium: 1.0, last_mark: 0.42, peak_premium: 1.1, trough_premium: 0.4 };
  assert.equal(ledgerDisplayPnlPct(row), PLAN_RULES.stop_pct); // peak +10% — no tranche armed
});

test("ledgerDisplayPnlPct: META-class stopped runner with +87% peak returns trim-scale blend (~+6.67%)", () => {
  // The policy is now STATED rather than assumed. This row is the real WS-10/WS-11 META case, which
  // committed under trim_scale — so the blend is the correct read for it and the expected value is
  // unchanged. Before the policy argument existed this same expectation was ALSO being applied to
  // ratchet-committed rows, which is the defect: see the REGRESSION test below.
  const row = { status: "CLOSED", entry_premium: 3.15, last_mark: 1.57, peak_premium: 5.9, trough_premium: 1.57, exitMode: "trim_scale" as const };
  assert.equal(ledgerDisplayPnlPct(row), 6.67);
  // Same row, ratchet-committed: nothing was banked, so the stop is the result.
  assert.equal(ledgerDisplayPnlPct({ ...row, exitMode: "ratchet" }), -50);
});

test("ledgerDisplayPnlPct: a non-stopped row derives from the mark (target/time-stop/live)", () => {
  // Target-hit CLOSED (peak tagged target) → mark-derived, not the −50 stop.
  assert.equal(ledgerDisplayPnlPct({ status: "CLOSED", entry_premium: 1.0, last_mark: 2.0, peak_premium: 2.1, trough_premium: 0.9 }), 100);
  // Live OPEN row.
  assert.equal(ledgerDisplayPnlPct({ status: "OPEN", entry_premium: 2.0, last_mark: 2.5, peak_premium: 2.5, trough_premium: 1.9 }), 25);
  // No mark → null.
  assert.equal(ledgerDisplayPnlPct({ status: "HOLD", entry_premium: 2.0, last_mark: null, peak_premium: 2.1, trough_premium: 1.9 }), null);
});

// ── advancePlayLatch: latches only WIDEN; a null mark advances the clock only ──────────
const NOW_OPEN = 600; // 10:00 ET — inside the trading window, before every cutoff

test("advancePlayLatch: a higher mark widens the peak; a lower mark widens the trough", () => {
  const play = { entry_premium: 1.0, peak_premium: null, trough_premium: null };
  const up = advancePlayLatch(play, null, 1.5, NOW_OPEN); // seeds from entry (1.0)
  assert.equal(up.peak, 1.5); // widened up
  assert.equal(up.trough, 1.0); // min(seed 1.0, 1.5) stays at the seed
  const down = advancePlayLatch(play, up, 0.8, NOW_OPEN);
  assert.equal(down.peak, 1.5); // peak does NOT shrink back
  assert.equal(down.trough, 0.8); // trough widened down
});

test("advancePlayLatch: latches NEVER narrow — a mark inside [trough,peak] leaves both unchanged", () => {
  const play = { entry_premium: 1.0, peak_premium: 1.8, trough_premium: 0.6 };
  const prior = { peak: 1.8, trough: 0.6, status: "HOLD" as const };
  const out = advancePlayLatch(play, prior, 1.2, NOW_OPEN);
  assert.equal(out.peak, 1.8);
  assert.equal(out.trough, 0.6);
});

test("advancePlayLatch: peak ≥ target → sticky TRIM; trough ≤ stop → CLOSED stopped", () => {
  const play = { entry_premium: 1.0, peak_premium: null, trough_premium: null };
  const trim = advancePlayLatch(play, null, 2.1, NOW_OPEN); // mark doubles → peak 2.1 ≥ target 2.0
  assert.equal(trim.status, "TRIM");
  const stopped = advancePlayLatch(play, null, 0.4, NOW_OPEN); // mark halves → trough 0.4 ≤ stop 0.5
  assert.equal(stopped.status, "CLOSED");
});

test("advancePlayLatch: a null mark advances the clock (time-stop) WITHOUT touching the latches", () => {
  const play = { entry_premium: 1.0, peak_premium: 1.5, trough_premium: 0.9 };
  const prior = { peak: 1.5, trough: 0.9, status: "HOLD" as const };
  const afterCutoff = advancePlayLatch(play, prior, null, PLAN_RULES.time_stop_et_minutes + 1); // 15:31 ET
  assert.equal(afterCutoff.peak, 1.5, "null mark leaves the peak latch untouched");
  assert.equal(afterCutoff.trough, 0.9, "null mark leaves the trough latch untouched");
  assert.equal(afterCutoff.status, "CLOSED"); // past the hard time stop
});

test("advancePlayLatch: OPEN band — a mark within ±10% of entry before the cutoff stays OPEN", () => {
  const play = { entry_premium: 1.0, peak_premium: null, trough_premium: null };
  const out = advancePlayLatch(play, null, 1.05, NOW_OPEN);
  assert.equal(out.status, "OPEN");
});

// ── executable-side edge cases (crossed/locked/one-sided books, f clamp) ──────────────
test("zeroDteHalfSpreadFrac: crossed and locked and one-sided books all return null (default frac used)", () => {
  assert.equal(zeroDteHalfSpreadFrac(1.2, 1.0), null); // crossed (ask < bid)
  assert.equal(zeroDteHalfSpreadFrac(1.0, 1.0), 0); // locked but valid → zero spread (not null)
  assert.equal(zeroDteHalfSpreadFrac(null, 1.0), null); // one-sided
  assert.equal(zeroDteHalfSpreadFrac(1.0, 0), null); // ask not > 0
  assert.equal(zeroDteHalfSpreadFrac(0, 1.0), 1.0); // bid 0 legal → frac (1−0)/(1+0) = 1
});

test("zeroDteExecutableEntry/Exit: negative frac is rejected (guards on !(f>=0)); exit floored at 0", () => {
  assert.equal(zeroDteExecutableEntry(1.0, -0.1), null); // bad frac → null (never flatters the fill)
  assert.equal(zeroDteExecutableExit(1.0, -0.1), null);
  assert.equal(zeroDteExecutableExit(1.0, 2.0), 0); // >100% frac clamped to a 0 bid, never negative
  assert.equal(zeroDteExecutableEntry(0, 0.1), null); // non-positive mid rejected on entry
  assert.equal(zeroDteExecutableExit(0, 0.1), 0); // a 0 mid is a legal 0 exit bid
});

test("executablePnlPct / executionTaxBps: null-guarded, mid always ≥ executable", () => {
  assert.equal(executablePnlPct(1.1, 0.9), -18.18);
  assert.equal(executablePnlPct(0, 0.9), null); // entry ask must be > 0
  assert.equal(executionTaxBps(100, 81.82), 1818); // the tax the mid lane hid
  assert.equal(executionTaxBps(null, 5), null);
});

// ── Condor seller-framed P&L (FINDINGS 2026-07-26 — the inverted credit-structure fix) ──────────
test("condorSellerPnlPct: a DECAYING (winning) condor is POSITIVE — the inverse of the long formula", () => {
  // Sold at 4.2 credit, bought back at 1.0 → (4.2−1.0)/4.2 = +76.19% (credit kept). The long formula
  // pinnedLivePnlPct would record the SAME row as −76.19% (the bug).
  assert.equal(condorSellerPnlPct(4.2, 1.0), 76.19);
  assert.equal(pinnedLivePnlPct(4.2, 1.0), -76.19); // proves they are exact mirrors
  // A breached condor whose mark blows OUT above the credit is a NEGATIVE (defined) loss.
  assert.equal(condorSellerPnlPct(4.2, 9.0), -114.29);
  // At the credit (mark == entry) the return is flat 0 either way.
  assert.equal(condorSellerPnlPct(4.2, 4.2), 0);
});

test("condorSellerPnlPct: null-safe (missing/zero entry or mark) — never fabricates a number", () => {
  assert.equal(condorSellerPnlPct(null, 1.0), null);
  assert.equal(condorSellerPnlPct(4.2, null), null);
  assert.equal(condorSellerPnlPct(0, 1.0), null); // non-positive credit rejected
  assert.equal(condorSellerPnlPct(-1, 1.0), null);
});

test("livePnlPctFor: seller-framed for a condor, byte-identical to pinnedLivePnlPct for a directional row", () => {
  // Condor branch → seller-framed positive winner.
  assert.equal(livePnlPctFor(true, 4.2, 1.0), 76.19);
  // Directional branch → the exact long-premium value, regression-locked.
  assert.equal(livePnlPctFor(false, 4.2, 1.0), -76.19);
  assert.equal(livePnlPctFor(false, 6.02, 7.38), pinnedLivePnlPct(6.02, 7.38)); // 22.59, unchanged
});

test("reconcileLedgerLivePnlPct: winning condor POSITIVE, breached condor NEGATIVE, directional unchanged", () => {
  // WINNING (decaying) condor → POSITIVE. No directional stop-pin is applied to a credit structure.
  assert.equal(
    reconcileLedgerLivePnlPct({ is_condor: true, closed_reason: null, entry_premium: 4.2, last_mark: 1.0 }),
    76.19
  );
  // BREACHED (losing) condor → NEGATIVE (defined loss).
  assert.equal(
    reconcileLedgerLivePnlPct({ is_condor: true, closed_reason: null, entry_premium: 4.2, last_mark: 9.0 }),
    -114.29
  );
  // A directional row is byte-identical to the previous inline (mark−entry)/entry expression.
  assert.equal(
    reconcileLedgerLivePnlPct({ is_condor: false, closed_reason: null, entry_premium: 6.02, last_mark: 7.38 }),
    22.59
  );
  // A directional STOPPED close with no trim tranches armed still pins to mechanical stop.
  assert.equal(
    reconcileLedgerLivePnlPct({ is_condor: false, closed_reason: "stopped", entry_premium: 6.02, last_mark: 2.0, peak_premium: 6.5, trough_premium: 2.0 }),
    PLAN_RULES.stop_pct
  );
  // META-class: peak +87% armed both trim tranches — as-managed blend, not −50%. The policy is now
  // STATED: this row committed under trim_scale, which is what earns the blend.
  assert.equal(
    reconcileLedgerLivePnlPct({
      is_condor: false,
      closed_reason: "stopped",
      entry_premium: 3.15,
      last_mark: 1.57,
      peak_premium: 5.9,
      trough_premium: 1.57,
      exit_policy_at_commit: "trim_scale",
    }),
    6.67
  );
});

// ---------------------------------------------------------------------------
// A STOPPED PLAY MUST NOT BE CREDITED WITH TRIM TRANCHES IT NEVER TOOK.
//
// `directionalClosedDisplayPnlPct` applied the trim-scale AS-MANAGED blend to every stopped
// directional row whose latched peak cleared +20%, without asking which policy had managed it.
// Not every row is on trim_scale: resolveExitModeForTier commits C-tier plays under RATCHET, and
// ZERODTE_EXIT_MODE=ratchet is an operator kill-switch for all tiers. A ratchet row banks NOTHING
// on the way up — that IS the difference between the policies — so crediting it a third at +20%
// and a third at +50% invents exits the member was never guided to take.
//
// The arithmetic is the whole finding: peak >= +50% then stopped at -50% renders as
// 1/3(+20) + 1/3(+50) + 1/3(-50) = +6.67%. A play that lost half its premium displays as a WINNER.
// ---------------------------------------------------------------------------

/** Peaked at +50% (arms both tranches), then stopped: trough at -50% of entry. */
const STOPPED_AFTER_BIG_PEAK = {
  status: "CLOSED" as const,
  entry_premium: 1.0,
  peak_premium: 1.5,
  trough_premium: 0.5,
  last_mark: 0.5,
};

test("REGRESSION: a stopped RATCHET-committed play shows the real -50%, not a fabricated +6.67%", () => {
  const shown = directionalClosedDisplayPnlPct({ ...STOPPED_AFTER_BIG_PEAK, exitMode: "ratchet" });
  assert.equal(shown, -50, "a ratchet row banks nothing on the way up — the stop is the result");
  assert.ok(shown! < 0, "a play that lost half its premium must never display as a winner");
});

test("a stopped TRIM_SCALE-committed play still shows the as-managed blend", () => {
  // Unchanged behaviour for the policy the blend was written for: 1/3@+20 + 1/3@+50 + 1/3@-50.
  const shown = directionalClosedDisplayPnlPct({ ...STOPPED_AFTER_BIG_PEAK, exitMode: "trim_scale" });
  assert.equal(shown, 6.67);
});

test("an UNKNOWN policy (legacy row, no commit-time pin) pins to the stop rather than guessing", () => {
  // Of the two possible errors on a stopped play, understating it is the safe one. The mechanical
  // pin is also a number the published methodology already defines and reports.
  assert.equal(directionalClosedDisplayPnlPct({ ...STOPPED_AFTER_BIG_PEAK, exitMode: null }), -50);
  assert.equal(directionalClosedDisplayPnlPct(STOPPED_AFTER_BIG_PEAK), -50, "absent field behaves as unknown");
});

test("a stopped play that never armed a tranche is -50 under EVERY policy", () => {
  const smallPeak = { ...STOPPED_AFTER_BIG_PEAK, peak_premium: 1.05 }; // +5% peak, no tranche armed
  for (const exitMode of ["ratchet", "trim_scale", null] as const) {
    assert.equal(directionalClosedDisplayPnlPct({ ...smallPeak, exitMode }), -50, `exitMode=${exitMode}`);
  }
});

test("reconcileLedgerLivePnlPct honours the row's frozen policy end-to-end", () => {
  const base = {
    is_condor: false,
    closed_reason: "stopped" as const,
    entry_premium: 1.0,
    last_mark: 0.5,
    peak_premium: 1.5,
    trough_premium: 0.5,
    status: "CLOSED",
  };
  assert.equal(reconcileLedgerLivePnlPct({ ...base, exit_policy_at_commit: "ratchet" }), -50);
  assert.equal(reconcileLedgerLivePnlPct({ ...base, exit_policy_at_commit: "trim_scale" }), 6.67);
  assert.equal(reconcileLedgerLivePnlPct({ ...base, exit_policy_at_commit: null }), -50);
});

// ---------------------------------------------------------------------------
// ONE LATCH, TWO LANES — and they used to disagree.
//
// `advancePlayLatch` (the 1s marks lane) latched null-safely. `syncLedgerLiveState` in scan.ts
// latched inline as
//   Math.min(trough_premium ?? (entry_premium ?? Number.MAX_VALUE), mark ?? Number.MAX_VALUE)
// so a row with no prior trough, no entry premium and no fresh mark latched Number.MAX_VALUE —
// 1.7976931348623157e308 — and served it as `trough_premium` on the board. Iron condors are the
// population that reaches it: a credit structure carries no single entry premium, so the first `??`
// falls through, and any tick without a quote supplies the second.
//
// advancePlayLatch's doc comment CLAIMED it applied "the SAME peak/trough latch syncLedgerLiveState
// applies". It did not, and a claim of sameness backed by no shared code is exactly how they
// drifted — the same row could carry a different trough depending on which lane touched it last.
// ---------------------------------------------------------------------------

test("REGRESSION: nothing known on either side latches null, not MAX_VALUE", () => {
  const { peak, trough } = latchPremiumBounds(null, null, null);
  assert.equal(trough, null, "the old scan.ts form produced 1.7976931348623157e308 here");
  assert.equal(peak, null, "and its peak produced 0, which understates just as dishonestly");
});

test("the sentinel it replaced passes every finite check in the codebase", () => {
  // Asserted rather than footnoted: this is why the bug survived every existing numeric scan.
  assert.equal(Number.isFinite(Number.MAX_VALUE), true);
});

test("a mark with no seed sets both latches to that mark", () => {
  assert.deepEqual(latchPremiumBounds(null, null, 1.25), { peak: 1.25, trough: 1.25 });
});

test("latches only ever WIDEN from the seed", () => {
  assert.deepEqual(latchPremiumBounds(2.0, 0.8, 2.4), { peak: 2.4, trough: 0.8 });
  assert.deepEqual(latchPremiumBounds(2.0, 0.8, 0.5), { peak: 2.0, trough: 0.5 });
  assert.deepEqual(latchPremiumBounds(2.0, 0.8, 1.5), { peak: 2.0, trough: 0.8 });
});

test("a missing mark leaves the seeds untouched", () => {
  assert.deepEqual(latchPremiumBounds(2.0, 0.8, null), { peak: 2.0, trough: 0.8 });
});

test("non-finite inputs are rejected rather than latched", () => {
  assert.deepEqual(latchPremiumBounds(null, null, Number.NaN), { peak: null, trough: null });
  assert.deepEqual(latchPremiumBounds(null, null, Number.POSITIVE_INFINITY), { peak: null, trough: null });
  // A poisoned SEED is dropped too, so a row already carrying the old sentinel heals on next tick.
  assert.deepEqual(latchPremiumBounds(null, Number.MAX_VALUE * 2, 1.1), { peak: 1.1, trough: 1.1 });
});

test("the two lanes now agree BY CONSTRUCTION — advancePlayLatch routes through the same function", () => {
  // Same inputs through the public lane helper and the shared primitive must match exactly.
  const play = { entry_premium: null, peak_premium: null, trough_premium: null };
  const viaLane = advancePlayLatch(play, null, null, NOW_OPEN);
  const viaPrimitive = latchPremiumBounds(null, null, null);
  assert.equal(viaLane.peak, viaPrimitive.peak);
  assert.equal(viaLane.trough, viaPrimitive.trough);
  assert.equal(viaLane.trough, null, "the condor-shaped row is null on BOTH lanes now");
});

// ── closedPnlDisplay — the peak may only be shown when it was actually banked ──────────
//
// Fixtures are the REAL live board rows from 2026-08-20. Five of those seven closed rows
// displayed a non-negative number for a losing trade because the peak was shown
// unconditionally; only ONDS had banked a tranche.
const LIVE_2026_08_20 = [
  { ticker: "TEM", status: "CLOSED", peak_pnl_pct: 1.35, live_pnl_pct: -8.85 },
  { ticker: "ONDS", status: "CLOSED", peak_pnl_pct: 52.08, live_pnl_pct: 45.83 },
  { ticker: "SSPC", status: "CLOSED", peak_pnl_pct: -6.98, live_pnl_pct: -6.98 },
  { ticker: "TSLA", status: "CLOSED", peak_pnl_pct: 2.36, live_pnl_pct: -1.89 },
  { ticker: "SNDK", status: "CLOSED", peak_pnl_pct: 1.34, live_pnl_pct: -38.25 },
  { ticker: "HIMS", status: "CLOSED", peak_pnl_pct: -0.6, live_pnl_pct: -20.24 },
  { ticker: "LITE", status: "CLOSED", peak_pnl_pct: -0.49, live_pnl_pct: -25.86 },
];

test("a peak with NO tranche banked is not shown — the realized number is", () => {
  // SNDK is the worst case: +1.34% peak against a -38.25% realized loss.
  const v = closedPnlDisplay(LIVE_2026_08_20.find((r) => r.ticker === "SNDK")!);
  assert.equal(v.is_peak, false);
  assert.equal(v.tranches_armed, 0);
  assert.equal(v.pct, -38.25, "must show the realized loss, not the +1.34% high tick");
});

test("a peak that DID bank tranches is still shown — the fix is not a blanket ban", () => {
  const v = closedPnlDisplay(LIVE_2026_08_20.find((r) => r.ticker === "ONDS")!);
  assert.equal(v.is_peak, true);
  assert.equal(v.tranches_armed, 2, "peak 52.08 arms both the +20 and +50 tranches");
  assert.equal(v.pct, 52.08);
  assert.equal(v.realized_pct, 45.83, "the realized number must ride along for disclosure");
});

test("no closed row may display a number better than its realized P&L without banking", () => {
  for (const row of LIVE_2026_08_20) {
    const v = closedPnlDisplay(row);
    if (v.tranches_armed === 0) {
      assert.equal(v.pct, row.live_pnl_pct, `${row.ticker} must show realized`);
    }
    assert.ok(
      v.tranches_armed > 0 || (v.pct ?? 0) <= (row.live_pnl_pct ?? 0) + 1e-9,
      `${row.ticker} overstates its result with nothing banked`
    );
  }
});

test("the whole 2026-08-20 session stops reading green: 5 overstatements -> 0", () => {
  const overstated = LIVE_2026_08_20.filter((r) => {
    const v = closedPnlDisplay(r);
    return (v.pct ?? 0) > (r.live_pnl_pct ?? 0) + 0.05 && v.tranches_armed === 0;
  });
  assert.equal(overstated.length, 0);
});

test("an OPEN row is untouched — this rule is about closed results only", () => {
  const v = closedPnlDisplay({ status: "OPEN", peak_pnl_pct: 80, live_pnl_pct: 12 });
  assert.equal(v.is_peak, false);
  assert.equal(v.pct, 12, "a live position shows its live mark");
});

test("a missing peak falls back to the live mark rather than blanking the cell", () => {
  const v = closedPnlDisplay({ status: "CLOSED", peak_pnl_pct: null, live_pnl_pct: -50 });
  assert.equal(v.pct, -50);
  assert.equal(v.is_peak, false);
});

test("realized_pct is always carried, so a peak can never be shown without its disclosure", () => {
  for (const row of LIVE_2026_08_20) {
    const v = closedPnlDisplay(row);
    if (v.is_peak) assert.notEqual(v.realized_pct, null);
  }
});
