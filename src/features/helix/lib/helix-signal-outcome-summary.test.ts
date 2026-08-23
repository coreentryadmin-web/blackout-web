import test from "node:test";
import assert from "node:assert/strict";
import { summarizeHelixSignalOutcomes, MIN_GRADED_SAMPLE_FOR_WIN_RATE } from "./helix-signal-outcome-summary";
import type { HelixSignalOutcomeRow } from "@/lib/db";

function row(over: Partial<HelixSignalOutcomeRow>): HelixSignalOutcomeRow {
  return {
    id: 1,
    signal_type: "velocity_spike",
    ticker: "SPX",
    direction: null,
    fired_at: "2026-08-02T14:00:00.000Z",
    price_at_fire: 100,
    price_5m: null,
    price_15m: null,
    price_1h: null,
    outcome: "pending",
    ...over,
  };
}

// Root cause this test pins (Tier 2 item #10, Tier 3 sequencing-risk discipline): a
// win-rate must NEVER be shown off a handful of graded rows — that's exactly the
// fabricated-confidence risk the 2026-08-02 Helix audit flagged.
test("summarizeHelixSignalOutcomes: winRatePct is null below the minimum graded sample", () => {
  const rows = Array.from({ length: MIN_GRADED_SAMPLE_FOR_WIN_RATE - 1 }, () =>
    row({ outcome: "continued" })
  );
  const summary = summarizeHelixSignalOutcomes(rows);
  assert.equal(summary.gradedCount, MIN_GRADED_SAMPLE_FOR_WIN_RATE - 1);
  assert.equal(summary.winRatePct, null, "must not show a win rate below the minimum sample");
});

test("summarizeHelixSignalOutcomes: winRatePct appears once the minimum graded sample is reached", () => {
  const wins = Array.from({ length: 7 }, () => row({ outcome: "continued" }));
  const losses = Array.from({ length: 3 }, () => row({ outcome: "reversed" }));
  const summary = summarizeHelixSignalOutcomes([...wins, ...losses]);
  assert.equal(summary.gradedCount, 10);
  assert.equal(summary.winCount, 7);
  assert.equal(summary.winRatePct, 70);
});

test("summarizeHelixSignalOutcomes: pending rows count separately, never as a loss", () => {
  const graded = Array.from({ length: 10 }, () => row({ outcome: "continued" }));
  const pending = Array.from({ length: 5 }, () => row({ outcome: "pending" }));
  const summary = summarizeHelixSignalOutcomes([...graded, ...pending]);
  assert.equal(summary.gradedCount, 10);
  assert.equal(summary.pendingCount, 5);
  assert.equal(summary.winRatePct, 100);
});

test("summarizeHelixSignalOutcomes: 'flat' outcomes count as graded but not a win", () => {
  const rows = [
    ...Array.from({ length: 5 }, () => row({ outcome: "continued" })),
    ...Array.from({ length: 10 }, () => row({ outcome: "flat" })),
  ];
  const summary = summarizeHelixSignalOutcomes(rows);
  assert.equal(summary.gradedCount, 15);
  assert.equal(summary.winCount, 5);
  assert.equal(summary.winRatePct, Math.round((5 / 15) * 1000) / 10);
});

// ── Distribution guards ──────────────────────────────────────────────────────
// A single continuation rate cannot express the graded split, and the missing half changes the
// read. Live 2026-08-20: 40 graded = 25 continued / 12 flat / 3 reversed. "62.5%" implied 37.5%
// went wrong when only 7.5% reversed and 30% went nowhere.

test("the graded distribution is reported, not just the rate", () => {
  const rows = [
    ...Array.from({ length: 25 }, () => row({ outcome: "continued" })),
    ...Array.from({ length: 12 }, () => row({ outcome: "flat" })),
    ...Array.from({ length: 3 }, () => row({ outcome: "reversed" })),
    ...Array.from({ length: 10 }, () => row({ outcome: "pending" })),
  ];
  const s = summarizeHelixSignalOutcomes(rows);
  assert.equal(s.gradedCount, 40);
  assert.equal(s.pendingCount, 10);
  assert.equal(s.continuedCount, 25);
  assert.equal(s.flatCount, 12);
  assert.equal(s.reversedCount, 3);
  assert.equal(s.winRatePct, 62.5);
  // The complement of the rate is NOT the reversal rate — the whole point.
  assert.notEqual(100 - s.winRatePct!, (s.reversedCount / s.gradedCount) * 100);
});

test("the four graded buckets always sum to gradedCount", () => {
  const rows = [
    row({ outcome: "continued" }),
    row({ outcome: "flat" }),
    row({ outcome: "reversed" }),
    row({ outcome: "pending" }),
  ];
  const s = summarizeHelixSignalOutcomes(rows);
  assert.equal(s.continuedCount + s.flatCount + s.reversedCount + s.otherCount, s.gradedCount);
});

test("an unrecognised grade lands in otherCount instead of being absorbed", () => {
  // otherCount is derived by subtraction, so a future grader value cannot silently inflate
  // continued/flat/reversed or break the sum.
  const s = summarizeHelixSignalOutcomes([
    row({ outcome: "continued" }),
    row({ outcome: "some_new_grade" }),
  ]);
  assert.equal(s.gradedCount, 2);
  assert.equal(s.continuedCount, 1);
  assert.equal(s.otherCount, 1);
  assert.equal(s.continuedCount + s.flatCount + s.reversedCount + s.otherCount, s.gradedCount);
});

test("distribution counts are present even below the rate threshold, where the rate is null", () => {
  const rows = Array.from({ length: MIN_GRADED_SAMPLE_FOR_WIN_RATE - 1 }, () =>
    row({ outcome: "reversed" })
  );
  const s = summarizeHelixSignalOutcomes(rows);
  assert.equal(s.winRatePct, null, "rate withheld below threshold");
  // Counts are raw observations, not an inference — withholding them too would hide the fact
  // that every graded firing so far REVERSED, which is exactly what a member needs to know.
  assert.equal(s.reversedCount, MIN_GRADED_SAMPLE_FOR_WIN_RATE - 1);
  assert.equal(s.continuedCount, 0);
});

// ── Per-signal-type breakdown ────────────────────────────────────────────────
// "Which HELIX signal is more reliable, split_flow or velocity_spike?" must be answerable from
// the aggregate payload, each type with its OWN denominator and its OWN sub-threshold null.

test("bySignalType splits the population per type, each with its own denominator", () => {
  const rows = [
    ...Array.from({ length: 10 }, () => row({ signal_type: "velocity_spike", outcome: "continued" })),
    ...Array.from({ length: 6 }, () => row({ signal_type: "split_flow", outcome: "continued" })),
    ...Array.from({ length: 4 }, () => row({ signal_type: "split_flow", outcome: "reversed" })),
  ];
  const s = summarizeHelixSignalOutcomes(rows);
  const vel = s.bySignalType.find((t) => t.signal_type === "velocity_spike")!;
  const split = s.bySignalType.find((t) => t.signal_type === "split_flow")!;
  assert.equal(vel.gradedCount, 10);
  assert.equal(vel.winRatePct, 100);
  assert.equal(split.gradedCount, 10);
  assert.equal(split.winRatePct, 60);
  assert.equal(split.reversedCount, 4);
});

test("per-type rate is null below the per-type minimum even when the aggregate clears it", () => {
  // The whole point: a type carried by 3 fires must not borrow the aggregate's confidence. Aggregate
  // here is 12 graded (rate shown); split_flow alone is 3 graded (rate withheld).
  const rows = [
    ...Array.from({ length: 9 }, () => row({ signal_type: "velocity_spike", outcome: "continued" })),
    ...Array.from({ length: 3 }, () => row({ signal_type: "split_flow", outcome: "continued" })),
  ];
  const s = summarizeHelixSignalOutcomes(rows);
  assert.equal(s.gradedCount, 12);
  assert.notEqual(s.winRatePct, null, "aggregate clears the threshold");
  const split = s.bySignalType.find((t) => t.signal_type === "split_flow")!;
  assert.equal(split.gradedCount, 3);
  assert.equal(split.winRatePct, null, "a 3-fire type must not report a rate");
  assert.equal(split.continuedCount, 3, "…but its raw counts are still present");
});

test("per-type graded counts sum to the aggregate, and types sort most-graded-first", () => {
  const rows = [
    ...Array.from({ length: 5 }, () => row({ signal_type: "split_flow", outcome: "continued" })),
    ...Array.from({ length: 12 }, () => row({ signal_type: "velocity_spike", outcome: "flat" })),
    ...Array.from({ length: 3 }, () => row({ signal_type: "velocity_spike", outcome: "pending" })),
  ];
  const s = summarizeHelixSignalOutcomes(rows);
  assert.equal(
    s.bySignalType.reduce((n, t) => n + t.gradedCount, 0),
    s.gradedCount
  );
  assert.equal(
    s.bySignalType.reduce((n, t) => n + t.pendingCount, 0),
    s.pendingCount
  );
  // velocity_spike has more graded (12) than split_flow (5) → it leads.
  assert.equal(s.bySignalType[0].signal_type, "velocity_spike");
});

test("an empty signal_type is bucketed as 'unknown', never dropped from the reconciliation", () => {
  const s = summarizeHelixSignalOutcomes([
    row({ signal_type: "", outcome: "continued" }),
    row({ signal_type: "velocity_spike", outcome: "reversed" }),
  ]);
  const unknown = s.bySignalType.find((t) => t.signal_type === "unknown");
  assert.ok(unknown, "empty type must surface as 'unknown'");
  assert.equal(unknown!.gradedCount, 1);
  assert.equal(
    s.bySignalType.reduce((n, t) => n + t.gradedCount, 0),
    s.gradedCount,
    "unknown bucket keeps the per-type total reconciled with the aggregate"
  );
});

// ── Graded-population TIME span ───────────────────────────────────────────────
// A rate is a number with no time until it names the window it covers. The ledger holds the 50
// most-recent rows and a fire cannot be graded until forward bars exist, so early in a session
// every graded row is from a PRIOR session (measured live 2026-08-21 09:40 ET: all 40 graded fires
// were 2026-08-20 14:00–16:30 ET). The span must describe the GRADED rows the rate is over — not
// the fetched set, whose newest rows are today's still-pending fires the rate does not include.

test("gradedOldestFiredAt/NewestFiredAt bound the GRADED rows, not the pending ones", () => {
  const s = summarizeHelixSignalOutcomes([
    // 10 graded, all yesterday afternoon ET (18:00–20:30Z = 14:00–16:30 ET on 2026-08-20).
    ...Array.from({ length: 6 }, () => row({ outcome: "continued", fired_at: "2026-08-20T18:00:00.000Z" })),
    ...Array.from({ length: 4 }, () => row({ outcome: "reversed", fired_at: "2026-08-20T20:30:00.000Z" })),
    // Today's still-pending fires are NEWER but must not widen the graded span.
    row({ outcome: "pending", fired_at: "2026-08-21T13:40:00.000Z" }),
  ]);
  assert.equal(s.gradedCount, 10);
  assert.equal(s.gradedOldestFiredAt, "2026-08-20T18:00:00.000Z");
  assert.equal(s.gradedNewestFiredAt, "2026-08-20T20:30:00.000Z", "the pending 13:40Z row must NOT be the newest");
});

test("the span is the RAW ledger string, unparsed — no timezone reinterpretation in the pure layer", () => {
  const s = summarizeHelixSignalOutcomes([
    row({ outcome: "continued", fired_at: "2026-08-20T18:00:00+00:00" }),
    row({ outcome: "continued", fired_at: "2026-08-20T19:30:00+00:00" }),
  ]);
  assert.equal(s.gradedOldestFiredAt, "2026-08-20T18:00:00+00:00");
  assert.equal(s.gradedNewestFiredAt, "2026-08-20T19:30:00+00:00");
});

test("graded span is null when nothing is graded — never a fabricated instant", () => {
  const s = summarizeHelixSignalOutcomes([
    row({ outcome: "pending", fired_at: "2026-08-21T13:40:00.000Z" }),
    row({ outcome: "pending", fired_at: "2026-08-21T13:50:00.000Z" }),
  ]);
  assert.equal(s.gradedCount, 0);
  assert.equal(s.gradedOldestFiredAt, null);
  assert.equal(s.gradedNewestFiredAt, null);
});

test("an unparseable fired_at is skipped, not allowed to poison the span to Invalid Date", () => {
  const s = summarizeHelixSignalOutcomes([
    row({ outcome: "continued", fired_at: "not-a-date" }),
    row({ outcome: "continued", fired_at: "2026-08-20T18:00:00.000Z" }),
  ]);
  assert.equal(s.gradedOldestFiredAt, "2026-08-20T18:00:00.000Z");
  assert.equal(s.gradedNewestFiredAt, "2026-08-20T18:00:00.000Z");
});

test("each signal type carries its OWN graded span", () => {
  const s = summarizeHelixSignalOutcomes([
    ...Array.from({ length: 3 }, () => row({ signal_type: "velocity_spike", outcome: "continued", fired_at: "2026-08-20T14:00:00.000Z" })),
    ...Array.from({ length: 3 }, () => row({ signal_type: "split_flow", outcome: "continued", fired_at: "2026-08-19T14:00:00.000Z" })),
  ]);
  const vs = s.bySignalType.find((t) => t.signal_type === "velocity_spike");
  const sf = s.bySignalType.find((t) => t.signal_type === "split_flow");
  assert.equal(vs?.gradedNewestFiredAt, "2026-08-20T14:00:00.000Z");
  assert.equal(sf?.gradedNewestFiredAt, "2026-08-19T14:00:00.000Z", "split_flow's window is its own, a day staler");
});

// ── The unfalsifiable-row inflation (2026-08-23) ──────────────────────────────────────────────
//
// `gradeOutcome` branches on bullish/bearish and lets everything else fall through to "continued".
// A split-flow firing that REFUSED to state a direction (`undetermined`/`mixed`) therefore grades
// continued on any move past the flat threshold, in EITHER direction, and can never be reversed.
// Those rows pool with genuine directional predictions and inflate the continuation rate.

const gradedRow = (
  over: Partial<HelixSignalOutcomeRow> = {}
): HelixSignalOutcomeRow => ({
  id: 1,
  signal_type: "split_flow",
  ticker: "NVDA",
  direction: "bullish",
  fired_at: "2026-08-21T18:00:00.000Z",
  price_at_fire: 100,
  price_5m: 100,
  price_15m: 100,
  price_1h: 101,
  outcome: "continued",
  ...over,
});

test("a refusal is counted as unfalsifiable, not as a directional prediction", () => {
  const rows = [
    ...Array.from({ length: 6 }, (_, i) => gradedRow({ id: i, direction: "undetermined" })),
    ...Array.from({ length: 4 }, (_, i) => gradedRow({ id: 100 + i, direction: "mixed" })),
  ];
  const s = summarizeHelixSignalOutcomes(rows);
  assert.equal(s.gradedCount, 10);
  assert.equal(s.directionalGradedCount, 0);
  assert.equal(s.unfalsifiableGradedCount, 10);
  // The headline rate still says 100% — that is exactly the inflation being surfaced, not hidden.
  assert.equal(s.winRatePct, 100);
  // ...and the honest one refuses, because no row could have been wrong.
  assert.equal(s.directionalWinRatePct, null);
});

test("velocity's explicit null direction is unfalsifiable too — it never claimed a side", () => {
  const rows = Array.from({ length: 10 }, (_, i) =>
    gradedRow({ id: i, signal_type: "velocity_spike", direction: null })
  );
  const s = summarizeHelixSignalOutcomes(rows);
  assert.equal(s.directionalGradedCount, 0);
  assert.equal(s.unfalsifiableGradedCount, 10);
});

test("the two rates diverge exactly as far as the unfalsifiable share is large", () => {
  // 10 directional rows going 6 continued / 4 reversed, plus 10 refusals that cannot lose.
  const rows = [
    ...Array.from({ length: 6 }, (_, i) => gradedRow({ id: i, direction: "bullish", outcome: "continued" })),
    ...Array.from({ length: 4 }, (_, i) => gradedRow({ id: 50 + i, direction: "bearish", outcome: "reversed" })),
    ...Array.from({ length: 10 }, (_, i) => gradedRow({ id: 100 + i, direction: "undetermined", outcome: "continued" })),
  ];
  const s = summarizeHelixSignalOutcomes(rows);
  assert.equal(s.gradedCount, 20);
  assert.equal(s.winRatePct, 80);            // 16/20 — inflated by the 10 that could not lose
  assert.equal(s.directionalGradedCount, 10);
  assert.equal(s.directionalWinRatePct, 60); // 6/10 — the number that answers "is it right?"
});

test("the two counts always reconcile to gradedCount", () => {
  const rows = [
    gradedRow({ id: 1, direction: "bullish" }),
    gradedRow({ id: 2, direction: null }),
    gradedRow({ id: 3, direction: "undetermined" }),
    gradedRow({ id: 4, direction: "a value nobody has added yet" }),
    gradedRow({ id: 5, outcome: "pending" }),
  ];
  const s = summarizeHelixSignalOutcomes(rows);
  assert.equal(s.directionalGradedCount + s.unfalsifiableGradedCount, s.gradedCount);
  // An unrecognised direction must land on the UNFALSIFIABLE side — `gradeOutcome` will send it
  // through the same fall-through. Testing by inclusion on bullish/bearish is what guarantees this.
  assert.equal(s.directionalGradedCount, 1);
});

test("pending rows count toward neither", () => {
  const s = summarizeHelixSignalOutcomes([
    gradedRow({ id: 1, direction: "bullish", outcome: "pending" }),
    gradedRow({ id: 2, direction: "undetermined", outcome: "pending" }),
  ]);
  assert.equal(s.gradedCount, 0);
  assert.equal(s.directionalGradedCount, 0);
  assert.equal(s.unfalsifiableGradedCount, 0);
  assert.equal(s.directionalWinRatePct, null);
});

test("per-signal-type rows carry the split too, so split_flow can be read on its own", () => {
  const rows = [
    ...Array.from({ length: 10 }, (_, i) => gradedRow({ id: i, signal_type: "split_flow", direction: "bullish" })),
    ...Array.from({ length: 10 }, (_, i) =>
      gradedRow({ id: 100 + i, signal_type: "velocity_spike", direction: null })
    ),
  ];
  const s = summarizeHelixSignalOutcomes(rows);
  const split = s.bySignalType.find((t) => t.signal_type === "split_flow")!;
  const velocity = s.bySignalType.find((t) => t.signal_type === "velocity_spike")!;
  assert.equal(split.directionalGradedCount, 10);
  assert.equal(split.directionalWinRatePct, 100);
  assert.equal(velocity.directionalGradedCount, 0);
  assert.equal(velocity.directionalWinRatePct, null);
});
