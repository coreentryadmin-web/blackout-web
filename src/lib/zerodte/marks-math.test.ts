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
import { gradePlanExecutableFromBars, gradePlanFromBars, type PlanBar } from "./plan";

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
