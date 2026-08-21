import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  describeEmCoverage,
  rankEarningsForExpectedMove,
  type EmCandidate,
} from "./meridian-em-priority";

/**
 * The live shape: a long calendar-ordered lane where the names anyone is watching sit late.
 * NVDA is at index 40 on purpose — past the real BATCH_CAP of 36, which is exactly why it showed
 * no implied move on prod despite having a chain that returns 7.7% when asked.
 */
function liveShapedLane(): EmCandidate[] {
  const filler: EmCandidate[] = Array.from({ length: 40 }, (_, i) => ({
    ticker: `MICRO${String(i).padStart(2, "0")}`,
    report_date: "2026-08-24",
    impact: "low",
    importance: 0,
    days_until: 3,
  }));
  return [
    ...filler,
    { ticker: "NVDA", report_date: "2026-08-26", impact: "high", importance: 5, days_until: 5 },
    { ticker: "VEEV", report_date: "2026-08-26", impact: "high", importance: 4, days_until: 5 },
    { ticker: "HPQ", report_date: "2026-08-27", impact: "high", importance: 4, days_until: 6 },
  ];
}

describe("the expected-move budget goes where it changes a decision", () => {
  test("NVDA survives the cap — the exact live defect", () => {
    // Before: `[...map.entries()].slice(0, 36)` in insertion order, so 36 pulls went to MICRO00-35
    // and NVDA, VEEV and HPQ got none. Measured on prod: 154 prints, 36 attempted, 7 resolved, and
    // every resolved name sat at position 2-33.
    const { attempt, skipped, requested } = rankEarningsForExpectedMove(liveShapedLane(), 36);
    assert.equal(requested, 43);
    assert.equal(attempt.length, 36);
    assert.equal(skipped.length, 7);

    const attempted = new Set(attempt.map((c) => c.ticker));
    for (const t of ["NVDA", "VEEV", "HPQ"]) {
      assert.ok(attempted.has(t), `${t} must get a chain pull — it is why the budget exists`);
    }
    // And they lead, so even a much smaller cap would still cover them.
    assert.deepEqual(attempt.slice(0, 3).map((c) => c.ticker), ["NVDA", "VEEV", "HPQ"]);
    assert.ok(skipped.every((c) => c.ticker.startsWith("MICRO")), "only filler should be dropped");
  });

  test("impact outranks importance outranks proximity, and ties break deterministically", () => {
    // Determinism matters more than the exact weights: an unstable order would make the covered
    // set flap between loads, so a name would gain and lose its implied move at random.
    const ranked = rankEarningsForExpectedMove(
      [
        { ticker: "SOON_LOW", report_date: "2026-08-21", impact: "low", importance: 5, days_until: 0 },
        { ticker: "FAR_HIGH", report_date: "2026-09-10", impact: "high", importance: 1, days_until: 20 },
        { ticker: "MID_HIGH", report_date: "2026-08-30", impact: "high", importance: 3, days_until: 9 },
        { ticker: "BBB", report_date: "2026-08-30", impact: "high", importance: 3, days_until: 9 },
      ],
      4
    );
    assert.deepEqual(ranked.attempt.map((c) => c.ticker), ["BBB", "MID_HIGH", "FAR_HIGH", "SOON_LOW"]);
  });

  test("an unknown date sorts LAST, never ahead of a confirmed mega-cap print", () => {
    // Handing a scarce chain pull to the row we know least about is the original bug in miniature.
    const { attempt } = rankEarningsForExpectedMove(
      [
        { ticker: "NODATE", report_date: "2026-08-30", impact: "high", importance: 5, days_until: null },
        { ticker: "KNOWN", report_date: "2026-08-30", impact: "high", importance: 5, days_until: 9 },
      ],
      2
    );
    assert.deepEqual(attempt.map((c) => c.ticker), ["KNOWN", "NODATE"]);
  });

  test("rows with no ticker or no date are dropped before the cap is spent on them", () => {
    const { attempt, requested } = rankEarningsForExpectedMove(
      [
        { ticker: "", report_date: "2026-08-26" },
        { ticker: "AAPL", report_date: "" },
        { ticker: " nvda ", report_date: "2026-08-26T00:00:00Z", impact: "high" },
      ],
      10
    );
    assert.equal(requested, 1);
    assert.deepEqual(attempt.map((c) => c.ticker), ["NVDA"]);
    assert.equal(attempt[0]!.report_date, "2026-08-26", "the date is normalized to a YMD");
  });

  test("a duplicate ticker takes one slot, not two", () => {
    const { attempt, requested } = rankEarningsForExpectedMove(
      [
        { ticker: "NVDA", report_date: "2026-08-26", impact: "high" },
        { ticker: "NVDA", report_date: "2026-08-26", impact: "high" },
      ],
      10
    );
    assert.equal(requested, 1);
    assert.equal(attempt.length, 1);
  });

  test("a zero or negative cap attempts nothing and says everything was skipped", () => {
    for (const cap of [0, -5]) {
      const r = rankEarningsForExpectedMove(liveShapedLane(), cap);
      assert.equal(r.attempt.length, 0);
      assert.equal(r.skipped.length, 43, `cap=${cap}`);
    }
  });
});

describe("coverage distinguishes 'no chain' from 'never looked'", () => {
  test("a truncated run says so, with the numbers", () => {
    const c = describeEmCoverage(154, 36, 7);
    assert.equal(c.requested, 154);
    assert.equal(c.attempted, 36);
    assert.equal(c.skipped, 118);
    assert.equal(c.resolved, 7);
    assert.match(c.note!, /not looked up/i);
    assert.match(c.note!, /118/);
    assert.doesNotMatch(c.note!, /no options market"?\s*$/, "the note must not itself assert absence");
  });

  test("a complete run carries NO note — silence only when nothing was skipped", () => {
    // The note exists to warn about a gap we created. Emitting it unconditionally would train the
    // reader to ignore it exactly when it matters.
    const c = describeEmCoverage(20, 20, 6);
    assert.equal(c.skipped, 0);
    assert.equal(c.note, null);
    assert.equal(c.resolved, 6, "14 attempted-but-unresolved is a fact about THOSE NAMES, not our budget");
  });

  test("skipped never goes negative if attempted somehow exceeds requested", () => {
    assert.equal(describeEmCoverage(5, 9, 3).skipped, 0);
  });
});
