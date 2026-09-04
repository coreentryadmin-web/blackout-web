// plan.ts — the 0DTE contract-plan grading + quote-validity leaf. These cover the
// EDGE/BOUNDARY behaviors the accountability half depends on: the conservative same-bar
// tie-break, flag-bar exclusion, the 15:30 time stop, ungradeable guards, the trim-scale
// reconstruction collisions, and every fail-closed QuoteInvalidReason. Pure — no DB, no
// providers, no wall clock; every bar timestamp is pinned in UTC and read in ET via Intl.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildContractPlan,
  evaluateQuoteValidity,
  gradePlanExecutableFromBars,
  gradePlanFromBars,
  NEW_PLAY_CUTOFF_ET_MINUTES,
  PLAN_ILLIQUID_SPREAD_PCT,
  PLAN_RULES,
  QUOTE_VALIDITY,
  reconstructTrimScaleExecutableFromBars,
  type PlanBar,
  type TrimScaleSpec,
} from "./plan";

// Summer EDT (UTC-4): 14:00Z = 10:00 ET (600 min), 19:50Z = 15:50 ET (the time stop),
// 19:51Z = 15:51 ET (past it). All bars below sit deterministically in that frame.
const T = (hhmm: string): number => Date.parse(`2026-07-10T${hhmm}:00Z`);

// ════════════════════════════════════════════════════════════════════════════════════
// gradePlanFromBars — the MID hold-to-stop/target grade.
// ════════════════════════════════════════════════════════════════════════════════════

test("gradePlanFromBars: same-bar stop+target tie books the STOP (conservative — intrabar order unknowable)", () => {
  const flag = T("13:59");
  // entry 1.0 → stop 0.5, target 2.0. One bar touches BOTH (h 2.5 ≥ target, l 0.4 ≤ stop).
  const bars: PlanBar[] = [{ t: T("14:00"), h: 2.5, l: 0.4, c: 1.0 }];
  const out = gradePlanFromBars(bars, 1.0, flag);
  assert.equal(out.outcome, "stopped"); // stop checked before target in the same bar
  assert.equal(out.pnl_pct, -50); // (0.5 − 1)/1 ×100
});

test("gradePlanFromBars: a target-only bar (no stop touch) doubles", () => {
  const flag = T("13:59");
  const bars: PlanBar[] = [{ t: T("14:00"), h: 2.1, l: 0.9, c: 2.0 }];
  assert.deepEqual(gradePlanFromBars(bars, 1.0, flag), { outcome: "doubled", pnl_pct: 100 });
});

test("gradePlanFromBars: the FLAG bar itself is excluded (bar.t ≤ flag skipped — no intrabar clairvoyance)", () => {
  const flag = T("14:00");
  const bars: PlanBar[] = [
    { t: T("14:00"), h: 3.0, l: 0.1, c: 1.0 }, // == flag → excluded even though it 'touched' both
    { t: T("14:05"), h: 1.2, l: 1.05, c: 1.1 }, // the real post-flag bar → a modest time-stop
  ];
  const out = gradePlanFromBars(bars, 1.0, flag);
  assert.equal(out.outcome, "time_stop"); // NOT doubled/stopped from the flag bar
  assert.equal(out.pnl_pct, 10); // last close 1.1
});

test("gradePlanFromBars: past 15:50 ET the walk BREAKS before grading — a late spike/crash is ignored", () => {
  const flag = T("13:59");
  const bars: PlanBar[] = [
    { t: T("14:00"), h: 1.2, l: 0.9, c: 1.1 }, // 10:00 ET, in window
    { t: T("19:00"), h: 1.4, l: 1.2, c: 1.3 }, // 15:00 ET, in window → last usable close
    { t: T("19:51"), h: 5.0, l: 0.1, c: 4.0 }, // 15:51 ET, PAST the stop → must be ignored
  ];
  const out = gradePlanFromBars(bars, 1.0, flag);
  assert.equal(out.outcome, "time_stop"); // the late bar neither doubled nor stopped it
  assert.equal(out.pnl_pct, 30); // (1.3 − 1)/1 — the last in-window close
});

test("gradePlanFromBars: a bar AT exactly 15:50 ET is still in the window (boundary inclusive)", () => {
  const flag = T("13:59");
  const bars: PlanBar[] = [{ t: T("19:50"), h: 1.5, l: 1.4, c: 1.45 }]; // 15:50 ET exactly
  const out = gradePlanFromBars(bars, 1.0, flag);
  assert.equal(out.outcome, "time_stop");
  assert.equal(out.pnl_pct, 45); // close 1.45 graded — 15:50 is NOT past the stop
});

test("gradePlanFromBars: NO bars strictly after the flag → ungradeable (never a fabricated fill)", () => {
  const flag = T("14:30");
  const bars: PlanBar[] = [{ t: T("14:00"), h: 2.0, l: 0.5, c: 1.0 }]; // all ≤ flag
  assert.deepEqual(gradePlanFromBars(bars, 1.0, flag), { outcome: "ungradeable", pnl_pct: null });
  assert.deepEqual(gradePlanFromBars([], 1.0, flag), { outcome: "ungradeable", pnl_pct: null });
});

test("gradePlanFromBars: a non-positive entry premium is ungradeable", () => {
  const flag = T("13:59");
  const bars: PlanBar[] = [{ t: T("14:00"), h: 2.1, l: 1.0, c: 2.0 }];
  assert.deepEqual(gradePlanFromBars(bars, 0, flag), { outcome: "ungradeable", pnl_pct: null });
  assert.deepEqual(gradePlanFromBars(bars, -1, flag), { outcome: "ungradeable", pnl_pct: null });
});

test("gradePlanFromBars: bars are walked in TIME order regardless of input order (first touch wins)", () => {
  const flag = T("13:59");
  // Out of order: the EARLIER bar stops; the later bar would double. Chronologically the stop wins.
  const bars: PlanBar[] = [
    { t: T("14:10"), h: 2.5, l: 2.0, c: 2.4 }, // later — would double
    { t: T("14:00"), h: 0.9, l: 0.4, c: 0.5 }, // earlier — stops first
  ];
  assert.equal(gradePlanFromBars(bars, 1.0, flag).outcome, "stopped");
});

test("gradePlanFromBars: frozen params override PLAN_RULES (custom target/stop/time-stop)", () => {
  const flag = T("13:59");
  // Custom target +50% (level 1.5): a 1.6 high doubles at the custom target, not the default 2.0.
  const bars: PlanBar[] = [{ t: T("14:00"), h: 1.6, l: 1.2, c: 1.55 }];
  const out = gradePlanFromBars(bars, 1.0, flag, { target_pct: 50, hard_stop_pct: -50 });
  assert.equal(out.outcome, "doubled");
  assert.equal(out.pnl_pct, 50); // graded against the COMMITTED target, not the live PLAN_RULES
  // A tighter custom time stop (e.g. 12:00 ET = 720 min) breaks earlier.
  const late: PlanBar[] = [{ t: T("18:00"), h: 1.2, l: 1.0, c: 1.1 }]; // 14:00 ET, past a 12:00 cap
  const capped = gradePlanFromBars(late, 1.0, flag, { time_stop_et_minutes: 720 });
  assert.equal(capped.outcome, "ungradeable"); // the only bar is past the tightened stop → no usable close
});

// ════════════════════════════════════════════════════════════════════════════════════
// gradePlanExecutableFromBars — the executable (bid/ask) grade + the f clamp.
// ════════════════════════════════════════════════════════════════════════════════════

test("gradePlanExecutableFromBars: same-bar bid stop+target tie books the STOP (conservative, like the mid grade)", () => {
  const flag = T("13:59");
  const bars: PlanBar[] = [{ t: T("14:00"), h: 3.0, l: 0.5, c: 1.0 }]; // bidLow 0.45 ≤ 0.5 stop; bidHigh 2.7 ≥ target
  const out = gradePlanExecutableFromBars(bars, 1.0, flag, 0.1);
  assert.equal(out.outcome, "stopped");
  assert.equal(out.pnl_pct, -54.55); // (0.5 − 1.1)/1.1 — stop level vs the ask entry basis
});

test("gradePlanExecutableFromBars: no post-flag bars → ungradeable; non-positive entry → ungradeable", () => {
  const flag = T("14:30");
  assert.equal(gradePlanExecutableFromBars([{ t: T("14:00"), h: 2, l: 1, c: 1.5 }], 1.0, flag, 0.1).outcome, "ungradeable");
  assert.equal(gradePlanExecutableFromBars([{ t: T("14:00"), h: 2, l: 1, c: 1.5 }], 0, T("13:59"), 0.1).outcome, "ungradeable");
});

test("gradePlanExecutableFromBars: a pathological half-spread is CLAMPED to 0.95 (exit side can't fully zero out)", () => {
  const flag = T("13:59");
  // f=5 would drive the whole exit side negative; the clamp holds it at 0.95 so the grade stays finite.
  const bars: PlanBar[] = [{ t: T("14:00"), h: 1.2, l: 1.1, c: 1.15 }];
  const out = gradePlanExecutableFromBars(bars, 1.0, flag, 5);
  assert.equal(out.outcome, "stopped"); // at f=0.95 the bid low 1.1×0.05 = 0.055 ≤ 0.5 stop
  assert.ok(Number.isFinite(out.pnl_pct!));
});

// ════════════════════════════════════════════════════════════════════════════════════
// reconstructTrimScaleExecutableFromBars — collisions the single walk can't express.
// ════════════════════════════════════════════════════════════════════════════════════

const NEUTRAL_TRIM: TrimScaleSpec = {
  trim_levels: [
    { trigger_pct: 25, fraction: 1 / 3 },
    { trigger_pct: 50, fraction: 1 / 3 },
  ],
  runner_fraction: 1 / 3,
};

test("reconstructTrimScale: a trim banked on an EARLY bar is SAFE when a LATER bar stops the runner", () => {
  const flag = T("13:59");
  // Bar 1 banks trim1 at 1.25 (bidHigh 1.26 ≥ 1.25). Bar 2 stops the remainder (bidLow 0.45 ≤ 0.5).
  const bars: PlanBar[] = [
    { t: T("14:00"), h: 1.4, l: 1.2, c: 1.35 }, // trim1 banks ⅓ @ 1.25
    { t: T("14:05"), h: 0.6, l: 0.5, c: 0.52 }, // runner stops the remaining ⅔
  ];
  const out = reconstructTrimScaleExecutableFromBars(bars, 1.0, flag, 0.1, NEUTRAL_TRIM);
  assert.equal(out.outcome, "stopped"); // the runner's fate labels the outcome
  assert.equal(out.tranches!.length, 2); // one banked trim + the stopped remainder
  assert.equal(out.tranches![0]!.exit_reason, "trim_scale_first");
  assert.equal(out.tranches![0]!.exit_pnl_pct, 13.64); // (1.25 − 1.1)/1.1 — locked in, NOT clawed back
  assert.equal(out.tranches![1]!.exit_reason, "stopped");
  assert.ok(Math.abs(out.tranches![1]!.fraction - 2 / 3) < 1e-9); // the whole remainder stops
  // Blended: the banked ⅓ profit softens the stopped ⅔ — strictly better than a full-position stop.
  const single = gradePlanExecutableFromBars(bars, 1.0, flag, 0.1);
  assert.ok(out.pnl_pct! > single.pnl_pct!, "partial banking beats the all-in single walk on the same bars");
});

test("reconstructTrimScale: an EMPTY ladder defers to the single executable walk (no drop to ungradeable)", () => {
  const flag = T("13:59");
  const bars: PlanBar[] = [{ t: T("14:00"), h: 2.3, l: 1.0, c: 2.2 }];
  const empty: TrimScaleSpec = { trim_levels: [], runner_fraction: 1 };
  assert.deepEqual(
    reconstructTrimScaleExecutableFromBars(bars, 1.0, flag, 0.1, empty),
    gradePlanExecutableFromBars(bars, 1.0, flag, 0.1)
  );
});

test("reconstructTrimScale: the runner rides to the +100% target after both trims bank (three doubled-runner legs)", () => {
  const flag = T("13:59");
  const bars: PlanBar[] = [
    { t: T("14:00"), h: 1.4, l: 1.2, c: 1.35 }, // trim1 @ 1.25
    { t: T("14:05"), h: 1.7, l: 1.5, c: 1.6 }, // trim2 @ 1.50
    { t: T("14:10"), h: 2.3, l: 1.6, c: 2.2 }, // runner bidHigh 2.07 ≥ 2.0 → doubles
  ];
  const out = reconstructTrimScaleExecutableFromBars(bars, 1.0, flag, 0.1, NEUTRAL_TRIM);
  assert.equal(out.outcome, "doubled");
  assert.equal(out.tranches!.length, 3);
  assert.equal(out.tranches![2]!.exit_reason, "doubled");
});

test("reconstructTrimScale: no post-flag bars → ungradeable (never a fabricated partial fill)", () => {
  const flag = T("14:30");
  const bars: PlanBar[] = [{ t: T("14:00"), h: 1.4, l: 1.2, c: 1.35 }];
  assert.deepEqual(
    reconstructTrimScaleExecutableFromBars(bars, 1.0, flag, 0.1, NEUTRAL_TRIM),
    { outcome: "ungradeable", pnl_pct: null }
  );
});

// ════════════════════════════════════════════════════════════════════════════════════
// buildContractPlan — illiquid spread cap override (amplify relief).
// ════════════════════════════════════════════════════════════════════════════════════

test("buildContractPlan: illiquidSpreadPct override widens G-9 cap", () => {
  const base = buildContractPlan({
    occ: "O:TEST",
    direction: "long",
    price: 100,
    flowAvgFill: 2,
    bid: 1.82,
    ask: 2.18,
    mark: 2,
    keySupports: [],
    keyResistances: [],
    vwap: null,
  });
  assert.equal(base.spread_pct, 18);
  assert.equal(base.illiquid, true);
  assert.equal(base.illiquid_spread_cap, PLAN_ILLIQUID_SPREAD_PCT);

  const wide = buildContractPlan({
    occ: "O:TEST",
    direction: "long",
    price: 100,
    flowAvgFill: 2,
    bid: 1.82,
    ask: 2.18,
    mark: 2,
    keySupports: [],
    keyResistances: [],
    vwap: null,
    illiquidSpreadPct: 22,
  });
  assert.equal(wide.illiquid, false);
  assert.equal(wide.illiquid_spread_cap, 22);
});

// ════════════════════════════════════════════════════════════════════════════════════
// evaluateQuoteValidity — every fail-closed QuoteInvalidReason + the valid pass.
// Checked most-degenerate-first: zero_bid → crossed → locked → mark_out_of_band →
// wide_dollars → thin_size → stale.
// ════════════════════════════════════════════════════════════════════════════════════

test("evaluateQuoteValidity: a clean two-sided book returns null (valid → committable)", () => {
  assert.equal(evaluateQuoteValidity({ bid: 1.0, ask: 1.2, mark: 1.1 }), null);
});

test("evaluateQuoteValidity: zero_bid — a null/≤0 bid OR a missing/≤0 ask (one-sided book) fails closed", () => {
  assert.equal(evaluateQuoteValidity({ bid: null, ask: 1.2, mark: 1.1 }), "zero_bid");
  assert.equal(evaluateQuoteValidity({ bid: 0, ask: 1.2, mark: 1.1 }), "zero_bid");
  assert.equal(evaluateQuoteValidity({ bid: 1.0, ask: null, mark: 1.1 }), "zero_bid");
  assert.equal(evaluateQuoteValidity({ bid: 1.0, ask: 0, mark: 1.1 }), "zero_bid");
});

test("evaluateQuoteValidity: crossed — ask < bid is an impossible/erroneous book", () => {
  assert.equal(evaluateQuoteValidity({ bid: 1.2, ask: 1.0, mark: 1.1 }), "crossed");
});

test("evaluateQuoteValidity: locked — ask == bid is a zero-width book (no real two-sided market)", () => {
  assert.equal(evaluateQuoteValidity({ bid: 1.0, ask: 1.0, mark: 1.0 }), "locked");
});

test("evaluateQuoteValidity: mark_out_of_band — a mark outside [bid, ask] (or null) is malformed/stale", () => {
  assert.equal(evaluateQuoteValidity({ bid: 1.0, ask: 1.2, mark: 1.3 }), "mark_out_of_band"); // above ask
  assert.equal(evaluateQuoteValidity({ bid: 1.0, ask: 1.2, mark: 0.9 }), "mark_out_of_band"); // below bid
  assert.equal(evaluateQuoteValidity({ bid: 1.0, ask: 1.2, mark: null }), "mark_out_of_band"); // no mark
  // Boundary: a mark sitting exactly on the bid or the ask is IN band (valid).
  assert.equal(evaluateQuoteValidity({ bid: 1.0, ask: 1.2, mark: 1.0 }), null);
  assert.equal(evaluateQuoteValidity({ bid: 1.0, ask: 1.2, mark: 1.2 }), null);
});

test("evaluateQuoteValidity: wide_dollars — an absolutely-huge spread the % check would wave through", () => {
  // spread 5.5 > the $5 cap, even though 5.5/3 ≈ proportionally not extreme; mark in band, not crossed.
  assert.equal(evaluateQuoteValidity({ bid: 1.0, ask: 6.5, mark: 3.0 }), "wide_dollars");
  assert.equal(QUOTE_VALIDITY.max_spread_dollars, 5.0);
  // Exactly at the cap is NOT wide (strict >).
  assert.equal(evaluateQuoteValidity({ bid: 1.0, ask: 6.0, mark: 3.0 }), null);
});

test("evaluateQuoteValidity: thin_size — enforced ONLY when the provider reports both sizes", () => {
  assert.equal(evaluateQuoteValidity({ bid: 1.0, ask: 1.2, mark: 1.1, bidSize: 0, askSize: 5 }), "thin_size");
  assert.equal(evaluateQuoteValidity({ bid: 1.0, ask: 1.2, mark: 1.1, bidSize: 5, askSize: 0 }), "thin_size");
  // Absent size is NOT proof of illiquidity → not enforced.
  assert.equal(evaluateQuoteValidity({ bid: 1.0, ask: 1.2, mark: 1.1, bidSize: null, askSize: 5 }), null);
  assert.equal(evaluateQuoteValidity({ bid: 1.0, ask: 1.2, mark: 1.1 }), null);
  // At the floor is fine.
  assert.equal(evaluateQuoteValidity({ bid: 1.0, ask: 1.2, mark: 1.1, bidSize: 1, askSize: 1 }), null);
});

test("evaluateQuoteValidity: stale — enforced ONLY when a quote age is supplied, boundary at the cap is fresh", () => {
  assert.equal(evaluateQuoteValidity({ bid: 1.0, ask: 1.2, mark: 1.1, quoteAgeMs: QUOTE_VALIDITY.max_quote_age_ms + 1 }), "stale");
  assert.equal(evaluateQuoteValidity({ bid: 1.0, ask: 1.2, mark: 1.1, quoteAgeMs: QUOTE_VALIDITY.max_quote_age_ms }), null); // == cap → fresh
  assert.equal(evaluateQuoteValidity({ bid: 1.0, ask: 1.2, mark: 1.1, quoteAgeMs: null }), null); // absence ≠ staleness
});

test("evaluateQuoteValidity: precedence — the MOST degenerate reason wins (crossed beats wide/stale)", () => {
  // A crossed book that is ALSO wide and stale reports 'crossed' (checked first).
  assert.equal(
    evaluateQuoteValidity({ bid: 9.0, ask: 1.0, mark: 5.0, quoteAgeMs: 999_999 }),
    "crossed"
  );
});

test("PLAN_RULES: the fixed 0DTE discipline is what the grades key on", () => {
  assert.equal(PLAN_RULES.stop_pct, -50);
  assert.equal(PLAN_RULES.target_pct, 100);
  assert.equal(PLAN_RULES.time_stop_et_minutes, 15 * 60 + 50);
  assert.equal(NEW_PLAY_CUTOFF_ET_MINUTES, 15 * 60 + 30);
});
