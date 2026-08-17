import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyPrintSession,
  hasPrinted,
  surpriseQuadrant,
  buildSurpriseScatter,
  buildCalendarGrid,
  buildBeatMissStreak,
  buildPrintClock,
  buildWeekPulse,
  fmtSurprisePct,
  fmtCompactMoney,
  fmtCountdown,
} from "./meridian-earnings-analytics-core";
import type { BenzingaStructuredEarnings } from "@/lib/providers/polygon";

/** Minimal row builder — every field the core reads, nothing it doesn't. */
function row(over: Partial<BenzingaStructuredEarnings> = {}): BenzingaStructuredEarnings {
  return {
    ticker: "NVDA",
    company_name: "NVIDIA",
    date: "2026-08-20",
    time: "16:20:00",
    date_status: "confirmed",
    importance: 5,
    fiscal_period: "Q2",
    fiscal_year: 2026,
    estimated_eps: 1.0,
    actual_eps: null,
    estimated_revenue: null,
    actual_revenue: null,
    eps_surprise: null,
    eps_surprise_pct: null,
    revenue_surprise: null,
    revenue_surprise_pct: null,
    previous_eps: null,
    previous_revenue: null,
    eps_method: null,
    revenue_method: null,
    notes: null,
    last_updated: null,
    benzinga_id: null,
    currency: "USD",
    ...over,
  } as BenzingaStructuredEarnings;
}

test("classifyPrintSession: pre / post / intraday split on the ET session boundaries", () => {
  assert.equal(classifyPrintSession("05:00:00"), "pre");
  assert.equal(classifyPrintSession("09:30:00"), "pre", "the open itself is still a pre-market print");
  assert.equal(classifyPrintSession("16:00:00"), "post", "the close itself is a post-market print");
  assert.equal(classifyPrintSession("16:30:00"), "post");
  assert.equal(classifyPrintSession("12:00:00"), "intraday");
  // Unknown is its OWN bucket, never folded into a tradeable one — a print whose hour we do not
  // know is exactly the one a member must not assume about.
  assert.equal(classifyPrintSession(null), "unknown");
  assert.equal(classifyPrintSession(""), "unknown");
  assert.equal(classifyPrintSession("garbage"), "unknown");
});

test("hasPrinted: only a finite actual_eps counts — null is NOT zero", () => {
  assert.equal(hasPrinted(row({ actual_eps: null })), false);
  assert.equal(hasPrinted(row({ actual_eps: 0 })), true, "an exactly-zero actual IS a real print");
  assert.equal(hasPrinted(row({ actual_eps: 1.2 })), true);
});

test("surpriseQuadrant: an exact in-line print (0) is a BEAT side, and missing axes are incomplete", () => {
  assert.equal(surpriseQuadrant(0.05, 0.02), "double_beat");
  assert.equal(surpriseQuadrant(0.05, -0.02), "eps_beat_rev_miss");
  assert.equal(surpriseQuadrant(-0.05, 0.02), "eps_miss_rev_beat");
  assert.equal(surpriseQuadrant(-0.05, -0.02), "double_miss");
  assert.equal(surpriseQuadrant(0, 0), "double_beat", "exactly in line is not a miss");
  // THE TRAP: null must not collapse to 0 and land a fabricated dot in the double-beat quadrant.
  assert.equal(surpriseQuadrant(null, 0.02), "incomplete");
  assert.equal(surpriseQuadrant(0.02, null), "incomplete");
  assert.equal(surpriseQuadrant(undefined, undefined), "incomplete");
  assert.equal(surpriseQuadrant(NaN, 0.02), "incomplete");
});

test("buildSurpriseScatter: pending and incomplete rows are COUNTED, never silently dropped", () => {
  const s = buildSurpriseScatter([
    row({ ticker: "A", actual_eps: 1, eps_surprise_pct: 0.1, revenue_surprise_pct: 0.05 }),
    row({ ticker: "B", actual_eps: 1, eps_surprise_pct: -0.2, revenue_surprise_pct: -0.1 }),
    row({ ticker: "C", actual_eps: 1, eps_surprise_pct: 0.03, revenue_surprise_pct: null }), // incomplete
    row({ ticker: "D", actual_eps: null }), // pending
  ]);
  assert.equal(s.points.length, 2);
  assert.equal(s.incomplete, 1, "reported so a partial scatter cannot read as a complete week");
  assert.equal(s.pending, 1);
  assert.equal(s.counts.double_beat, 1);
  assert.equal(s.counts.double_miss, 1);
  // Biggest absolute mover first, so the labelled dots are the ones that matter.
  assert.equal(s.points[0]!.ticker, "B");
  // Symmetric bound keeps the origin centred and both sides comparable.
  assert.ok(s.bound >= 0.2 && s.bound <= 0.4, `bound ${s.bound}`);
});

test("buildSurpriseScatter: a flat week still gets a usable axis floor", () => {
  const s = buildSurpriseScatter([
    row({ actual_eps: 1, eps_surprise_pct: 0.001, revenue_surprise_pct: 0.001 }),
  ]);
  assert.ok(s.bound >= 0.05, "a 0.1% week must not magnify noise into a dramatic spread");
});

test("buildCalendarGrid: day averages use PRINTED rows only, so a pending day stays unshaded", () => {
  const cells = buildCalendarGrid([
    row({ date: "2026-08-20", ticker: "A", actual_eps: 1, eps_surprise_pct: 0.1, importance: 5 }),
    row({ date: "2026-08-20", ticker: "B", actual_eps: null, importance: 2 }),
    row({ date: "2026-08-21", ticker: "C", actual_eps: null, importance: 4 }),
  ]);
  assert.equal(cells.length, 2);
  const d20 = cells[0]!;
  assert.equal(d20.total, 2);
  assert.equal(d20.printed, 1);
  assert.equal(d20.megaCap, 1);
  // A pending row averaged as 0 would drag this toward "in line" and mis-colour the day.
  assert.equal(d20.avgEpsSurprisePct, 0.1);
  const d21 = cells[1]!;
  assert.equal(d21.avgEpsSurprisePct, null, "nothing printed => no colour, not zero");
  // Sorted by date ascending, rows within a day by importance desc.
  assert.equal(d20.rows[0]!.ticker, "A");
});

test("buildBeatMissStreak: an UNGRADED print breaks the streak instead of being skipped", () => {
  const rows = [
    row({ ticker: "T", date: "2026-01-01", actual_eps: 1, eps_surprise_pct: 0.1 }),
    row({ ticker: "T", date: "2026-04-01", actual_eps: 1, eps_surprise_pct: null }), // ungraded
    row({ ticker: "T", date: "2026-07-01", actual_eps: 1, eps_surprise_pct: 0.2 }),
    row({ ticker: "T", date: "2026-08-01", actual_eps: 1, eps_surprise_pct: 0.3 }),
  ];
  const s = buildBeatMissStreak("T", rows);
  assert.equal(s.entries.length, 4, "the ungraded quarter still appears in the history");
  assert.equal(s.entries[1]!.beat, null, "ungraded is null, NOT a miss");
  assert.equal(s.beats, 3);
  assert.equal(s.misses, 0);
  assert.equal(s.graded, 3);
  // Two consecutive beats, then the walk stops at the ungraded quarter — NOT 3.
  assert.equal(s.currentStreak, 2, "'2 straight beats' must mean two consecutive PRINTS");
});

test("buildBeatMissStreak: miss streaks are negative; empty history is null-rate not 0-rate", () => {
  const s = buildBeatMissStreak("T", [
    row({ ticker: "T", date: "2026-04-01", actual_eps: 1, eps_surprise_pct: -0.1 }),
    row({ ticker: "T", date: "2026-07-01", actual_eps: 1, eps_surprise_pct: -0.2 }),
  ]);
  assert.equal(s.currentStreak, -2);
  assert.equal(s.beatRate, 0, "two graded misses is a real 0% rate");

  const empty = buildBeatMissStreak("T", [row({ ticker: "T", actual_eps: null })]);
  assert.equal(empty.beatRate, null, "no graded prints => unknown rate, not 0%");
  assert.equal(empty.currentStreak, 0);
});

test("buildPrintClock: sorted soonest-first, unknown-time rows kept and sorted LAST", () => {
  const now = Date.parse("2026-08-20T12:00:00-04:00");
  const clock = buildPrintClock(
    [
      row({ ticker: "LATE", date: "2026-08-20", time: "16:30:00" }),
      row({ ticker: "SOON", date: "2026-08-20", time: "13:00:00" }),
      row({ ticker: "TBD", date: "2026-08-20", time: null, importance: 5 }),
      row({ ticker: "FAR", date: "2026-08-29", time: "16:00:00" }), // outside the 24h horizon
    ],
    now
  );
  assert.deepEqual(clock.map((c) => c.ticker), ["SOON", "LATE", "TBD"]);
  assert.equal(clock[0]!.minutesUntil, 60);
  assert.equal(clock[2]!.minutesUntil, null, "unknown time is null, not a fabricated 0");
  // A confirmed mega-cap with no stamped hour must NOT vanish from the clock.
  assert.equal(clock[2]!.ticker, "TBD");
});

test("buildPrintClock: a just-passed print stays briefly, a long-past one drops", () => {
  const now = Date.parse("2026-08-20T12:00:00-04:00");
  const clock = buildPrintClock(
    [
      row({ ticker: "JUST", date: "2026-08-20", time: "11:30:00" }), // -30m
      row({ ticker: "OLD", date: "2026-08-20", time: "05:00:00" }), // -7h
    ],
    now
  );
  assert.deepEqual(clock.map((c) => c.ticker), ["JUST"]);
  assert.equal(clock[0]!.minutesUntil, -30);
});

test("buildWeekPulse: beat rate counts only graded prints; medians never return NaN", () => {
  const p = buildWeekPulse([
    row({ ticker: "A", date: "2026-08-20", actual_eps: 1, eps_surprise_pct: 0.1, importance: 5 }),
    row({ ticker: "B", date: "2026-08-20", actual_eps: 1, eps_surprise_pct: -0.3, importance: 2 }),
    row({ ticker: "C", date: "2026-08-21", actual_eps: null, importance: 4, date_status: "projected" }),
  ]);
  assert.equal(p.total, 3);
  assert.equal(p.megaCap, 2);
  assert.equal(p.confirmed, 2);
  assert.equal(p.printed, 2);
  assert.equal(p.beats, 1);
  assert.equal(p.misses, 1);
  assert.equal(p.beatRate, 0.5);
  assert.ok(Math.abs((p.medianEpsSurprisePct ?? 0) - -0.1) < 1e-9);
  assert.equal(p.busiestDate, "2026-08-20");
  assert.equal(p.busiestCount, 2);

  const none = buildWeekPulse([]);
  assert.equal(none.beatRate, null);
  assert.equal(none.medianEpsSurprisePct, null, "empty median must be null, never NaN on a panel");
  assert.equal(none.busiestDate, null);
});

test("formatters: null renders as an em-dash, never as a fabricated zero", () => {
  assert.equal(fmtSurprisePct(null), "—");
  assert.equal(fmtSurprisePct(undefined), "—");
  assert.equal(fmtSurprisePct(NaN), "—");
  assert.equal(fmtSurprisePct(0), "0.0%", "a real in-line print IS zero and must show as zero");
  assert.equal(fmtSurprisePct(0.0447), "+4.5%");
  assert.equal(fmtSurprisePct(-0.12), "-12.0%");

  assert.equal(fmtCompactMoney(null), "—");
  assert.equal(fmtCompactMoney(82609000), "$82.6M");
  // 81.615 is stored as 81.61499... in binary float, so toFixed(2) truncates to .61 — not a bug,
  // and pinned here so nobody "fixes" the formatter to chase a half-cent that never existed.
  assert.equal(fmtCompactMoney(81615000000), "$81.61B");

  assert.equal(fmtCountdown(null), "time TBD");
  assert.equal(fmtCountdown(60), "in 1h 0m");
  assert.equal(fmtCountdown(-30), "30m ago");
  assert.equal(fmtCountdown(14), "in 14m");
});
