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
