import { before, test, mock } from "node:test";
import assert from "node:assert/strict";
import type { NighthawkPlayOutcomeRow } from "@/lib/db";
import { wilsonUpperBound } from "@/lib/swing/calibration";

// ── The "why does swings show 0%?" regression (2026-08-06) ───────────────────────────────
//
// LIVE payload from GET /api/market/nighthawk/record, days=30, captured while the market was
// open with real members reading it:
//
//   segments.current: { resolved 48, scoreable 22, wins 0, losses 2, opens 20, ambiguous 0,
//                       unfilled 16, pulled 12, win_rate_pct 0, win_rate_ci_high_pct 14.9,
//                       avg_return_pct 0.61, low_n false }
//   headline:         win_rate_pct 0, profitable_rate_pct 68.2, pending_count 5
//
// The win rate was `wins / scoreable`, and `scoreable` still contained the 20 rows graded
// 'open' — meaning the one-session grading horizon expired with NEITHER the published target
// nor the published stop touched. Those plays were never decided, but each one counted as a
// non-win, making a no-touch row arithmetically identical to a stop-out. Two independent
// tells that the denominator was 22 and not 2:
//   * Wilson 0/22 = 14.87% → the served 14.9 upper bound to the decimal (0/2 gives 65.8);
//   * profitable_rate 68.2% = 15/22, computed over that SAME array — so 15 of the 22 plays
//     the headline called non-wins actually closed green (+0.61% avg).
// And `low_n` keyed off the size of that polluted denominator (22 >= 5 → false), so the one
// badge built to stop a thin sample reading as a track record could never fire on a sample
// with two decided outcomes.
//
// This suite pins the corrected semantics on BOTH aggregations in analytics.ts — the segment
// builder AND the duplicated headline block in getNighthawkMetrics. The duplication is
// exactly how the bug survived review, so both are asserted against one fixture.

const state = { rows: [] as NighthawkPlayOutcomeRow[], pending: 0 };

function row(over: Partial<NighthawkPlayOutcomeRow>): NighthawkPlayOutcomeRow {
  return {
    id: 1,
    edition_for: "2026-07-30",
    ticker: "AAPL",
    direction: "LONG",
    conviction: "A",
    entry_range_low: 100,
    entry_range_high: 102,
    target: 112,
    stop: 95,
    score: 70,
    sector: "Technology",
    next_day_open: 101,
    next_day_close: 101.5,
    session_high: 104,
    session_low: 100.5,
    hit_target: false,
    hit_stop: false,
    outcome: "open",
    created_at: "2026-07-30T00:00:00.000Z",
    pulled: false,
    pulled_reason: null,
    publish_context: null,
    morning_verdict: null,
    grade_methodology: "v2_fillability",
    legacy_grade: null,
    ...over,
  };
}

/** The live 2026-08-06 current-methodology cohort, row for row:
 *  0 target + 2 stop + 20 open + 16 unfilled + 12 pulled. */
function liveCohort(): NighthawkPlayOutcomeRow[] {
  const rows: NighthawkPlayOutcomeRow[] = [];
  let id = 1;
  for (let i = 0; i < 2; i++) {
    rows.push(row({ id: id++, outcome: "stop", next_day_close: 94, session_low: 94 }));
  }
  for (let i = 0; i < 20; i++) rows.push(row({ id: id++, outcome: "open" }));
  for (let i = 0; i < 16; i++) rows.push(row({ id: id++, outcome: "unfilled" }));
  // `pulled` excludes on the boolean column regardless of the counterfactual grade.
  for (let i = 0; i < 12; i++) rows.push(row({ id: id++, outcome: "open", pulled: true }));
  return rows;
}

before(async () => {
  const realDb = await import("../../../lib/db");
  mock.module("../../../lib/db", {
    namedExports: {
      ...realDb,
      fetchNighthawkOutcomeAnalytics: async () => ({ rows: state.rows, pending_count: state.pending }),
      fetchNighthawkFunnelStats: async () => ({ published_count: 0, rejected_by_reason: [] }),
    },
  });
});

const mod = () => import("./analytics");

test("buildRecordSegment: opens are OUT of the win-rate denominator but stay in the exclusion accounting", async () => {
  const { buildRecordSegment } = await mod();
  const seg = buildRecordSegment("v2_fillability", liveCohort());

  // Exclusion discipline preserved exactly — this fix narrows the RATE's denominator, it does
  // not re-litigate which rows are scoreable.
  assert.equal(seg.resolved, 50);
  assert.equal(seg.scoreable, 22, "scoreable must still be 0 wins + 2 losses + 20 opens");
  assert.equal(seg.unfilled, 16);
  assert.equal(seg.pulled, 12);

  assert.equal(seg.wins, 0);
  assert.equal(seg.losses, 2);
  assert.equal(seg.opens, 20);
  assert.equal(seg.decided, 2, "the win-rate denominator is wins + losses, never scoreable");
  assert.equal(seg.win_rate, 0, "0 wins out of 2 DECIDED outcomes — a real, readable 0/2");
  assert.equal(
    seg.low_n,
    true,
    "low_n must key off decided (2 < 5), not off the 22-row scoreable set — the badge exists to stop exactly this sample reading as a record"
  );
});

test("buildRecordSegment: a cohort with ZERO decided outcomes serves win_rate null, never a fabricated 0", async () => {
  const { buildRecordSegment } = await mod();
  // The live days=7 cohort: 10 scoreable, 0 wins, 0 losses, 10 opens.
  const seg = buildRecordSegment(
    "v2_fillability",
    Array.from({ length: 10 }, (_, i) => row({ id: i + 1, outcome: "open" }))
  );
  assert.equal(seg.scoreable, 10);
  assert.equal(seg.decided, 0);
  assert.equal(seg.win_rate, null, "no decided outcome = no win rate; a 0 here reads as 'every play lost'");
  assert.equal(seg.low_n, true);
});

test("getNighthawkMetrics headline: same denominator as the segment (the duplicated block can't drift)", async () => {
  const { getNighthawkMetrics, buildRecordSegment } = await mod();
  state.rows = liveCohort();
  state.pending = 5;
  const metrics = await getNighthawkMetrics(30);

  assert.equal(metrics.decided_count, 2);
  assert.equal(metrics.opens_count, 20);
  assert.equal(metrics.win_rate, 0, "0 of 2 decided — NOT 0 of 22");
  assert.equal(metrics.low_n, true);
  assert.equal(metrics.segments.current.scoreable, 22);

  // The headline block and buildRecordSegment are two copies of the same math — pin them
  // to each other, since a segment-only fix would have left the headline serving 0/22.
  const seg = buildRecordSegment("v2_fillability", state.rows);
  assert.equal(metrics.win_rate, seg.win_rate);
  assert.equal(metrics.decided_count, seg.decided);
  assert.equal(metrics.low_n, seg.low_n);

  // profitable_rate / avg_return deliberately stay on the 22-row scoreable population:
  // they are legitimate over any graded row with a realized return. Re-basing them would be
  // denominator-shopping in the opposite direction.
  assert.equal(metrics.segments.current.scoreable, 22);
  assert.ok(metrics.profitable_rate > 0.6, "the same 22 rows still average a positive close-vs-entry");
});

test("Wilson n is DECIDED: the interval on 0/2 is [0, 65.8]% — 14.9% is the fingerprint of the bug", () => {
  const pct = (v: number) => Math.round(v * 1000) / 10;
  assert.equal(pct(wilsonUpperBound(0, 2)), 65.8, "the honest upper bound over 2 decided outcomes");
  // Regression tripwire: 14.9 is Wilson 0/22 and can only be produced by feeding the CI the
  // open-polluted scoreable count. If this ever equals the served upper bound again, the
  // denominator has regressed.
  assert.equal(pct(wilsonUpperBound(0, 22)), 14.9);
  assert.notEqual(pct(wilsonUpperBound(0, 2)), pct(wilsonUpperBound(0, 22)));
});

test("by_conviction: a bucket of nothing but no-touch plays carries no rate and badges low_n", async () => {
  const { getNighthawkMetrics } = await mod();
  // Live shape: conviction A n=12 and B n=10, both with ZERO decided outcomes, both served
  // as a confident 0% and painted onto the play card a member was deciding whether to take.
  state.rows = [
    ...Array.from({ length: 12 }, (_, i) => row({ id: i + 1, conviction: "A", outcome: "open" })),
    ...Array.from({ length: 10 }, (_, i) => row({ id: 100 + i, conviction: "B", outcome: "open" })),
  ];
  state.pending = 0;
  const metrics = await getNighthawkMetrics(30);

  const a = metrics.by_conviction.find((c) => c.conviction === "A");
  assert.ok(a);
  assert.equal(a.n, 12, "the bucket still has 12 scoreable rows");
  assert.equal(a.decided, 0);
  assert.equal(a.opens, 12);
  assert.equal(a.win_rate, null, "no decided outcome in the bucket = no badge-able rate");
  assert.equal(a.low_n, true);
});

test("a decided cut is unaffected: 3 targets + 1 stop + 6 opens is 75%, not 30%", async () => {
  const { groupWithReturn } = await mod();
  const rows = [
    ...Array.from({ length: 3 }, (_, i) => row({ id: i + 1, outcome: "target" })),
    row({ id: 4, outcome: "stop" }),
    ...Array.from({ length: 6 }, (_, i) => row({ id: 10 + i, outcome: "open" })),
  ];
  const cut = groupWithReturn(rows);
  assert.equal(cut.n, 10);
  assert.equal(cut.decided, 4);
  assert.equal(cut.opens, 6);
  assert.equal(cut.win_rate, 0.75, "3 of 4 DECIDED; the old math served 3/10 = 30%");
  assert.equal(cut.low_n, true, "4 decided is still under the shared low-n floor of 5");
});
