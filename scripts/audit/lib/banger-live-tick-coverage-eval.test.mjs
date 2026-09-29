import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  mapDbTickToReplayTick,
  ticksToReplaySeries,
  assessPositionCoverage,
  coverageEnvelopeOverlaps,
  buildReadinessReport,
  projectDaysToReadiness,
  isLegitimateWeekendOrOvernightGap,
} from "./banger-live-tick-coverage-eval.mjs";

describe("mapDbTickToReplayTick / ticksToReplaySeries", () => {
  test("maps a usable row to {t, mark, bid}", () => {
    const out = mapDbTickToReplayTick({ polled_at: "2026-09-27T14:00:00.000Z", bid: 1.2, reliable_mark: 1.5 });
    assert.equal(out.t, Date.parse("2026-09-27T14:00:00.000Z"));
    assert.equal(out.mark, 1.5);
    assert.equal(out.bid, 1.2);
  });

  test("falls back bid to mark when bid is not finite (never fabricates a tighter spread than observed, just uses mark)", () => {
    const out = mapDbTickToReplayTick({ polled_at: "2026-09-27T14:00:00.000Z", bid: null, reliable_mark: 1.5 });
    assert.equal(out.bid, 1.5);
  });

  test("returns null (never fabricates) when reliable_mark is absent -- production itself could not resolve a trustworthy mark at that tick", () => {
    assert.equal(mapDbTickToReplayTick({ polled_at: "2026-09-27T14:00:00.000Z", bid: 1, reliable_mark: null }), null);
  });

  test("returns null on an unparseable timestamp", () => {
    assert.equal(mapDbTickToReplayTick({ polled_at: "not-a-date", bid: 1, reliable_mark: 1.5 }), null);
  });

  test("ticksToReplaySeries filters out unusable rows while preserving order of the usable ones", () => {
    const rows = [
      { polled_at: "2026-09-27T14:00:00.000Z", bid: 1, reliable_mark: 1.5 },
      { polled_at: "2026-09-27T14:05:00.000Z", bid: null, reliable_mark: null },
      { polled_at: "2026-09-27T14:10:00.000Z", bid: 1.1, reliable_mark: 1.6 },
    ];
    const series = ticksToReplaySeries(rows);
    assert.equal(series.length, 2);
    assert.equal(series[0].mark, 1.5);
    assert.equal(series[1].mark, 1.6);
  });
});

const T = (iso) => Date.parse(iso);
const tick = (iso, mark) => ({ t: T(iso), mark, bid: mark });

describe("assessPositionCoverage", () => {
  test("FULL when the first/last tick land near entry/exit and no interior gap exceeds the ceiling", () => {
    const ticks = [
      tick("2026-09-27T14:02:00.000Z", 1.0),
      tick("2026-09-27T14:20:00.000Z", 1.3),
      tick("2026-09-27T14:38:00.000Z", 1.6),
      tick("2026-09-27T14:58:00.000Z", 1.4),
    ];
    const result = assessPositionCoverage({ committedAtMs: T("2026-09-27T14:00:00.000Z"), closedAtMs: T("2026-09-27T15:00:00.000Z"), ticks }, { cadenceMinutes: 20 });
    assert.equal(result.coverage, "FULL");
    assert.deepEqual(result.reasons, []);
    assert.equal(result.tickCount, 4);
  });

  test("NONE with zero ticks -- names the reason, never silently treats absence as coverage", () => {
    const result = assessPositionCoverage({ committedAtMs: T("2026-09-27T14:00:00.000Z"), closedAtMs: T("2026-09-27T15:00:00.000Z"), ticks: [] });
    assert.equal(result.coverage, "NONE");
    assert.deepEqual(result.reasons, ["no_ticks_in_window"]);
  });

  test("NONE on an invalid lifecycle window (closedAt before/at committedAt), never divides by a bogus span", () => {
    const result = assessPositionCoverage({ committedAtMs: T("2026-09-27T15:00:00.000Z"), closedAtMs: T("2026-09-27T14:00:00.000Z"), ticks: [tick("2026-09-27T14:30:00.000Z", 1)] });
    assert.equal(result.coverage, "NONE");
    assert.deepEqual(result.reasons, ["invalid_lifecycle_window"]);
  });

  test("PARTIAL_START when logging began well after entry", () => {
    const ticks = [tick("2026-09-27T14:50:00.000Z", 1.2), tick("2026-09-27T14:58:00.000Z", 1.4)];
    const result = assessPositionCoverage({ committedAtMs: T("2026-09-27T14:00:00.000Z"), closedAtMs: T("2026-09-27T15:00:00.000Z"), ticks });
    assert.equal(result.coverage, "PARTIAL_START");
    assert.ok(result.reasons[0].startsWith("start_gap_"));
  });

  test("PARTIAL_END when logging stopped well before exit", () => {
    const ticks = [tick("2026-09-27T14:02:00.000Z", 1.0), tick("2026-09-27T14:10:00.000Z", 1.1)];
    const result = assessPositionCoverage({ committedAtMs: T("2026-09-27T14:00:00.000Z"), closedAtMs: T("2026-09-27T15:00:00.000Z"), ticks });
    assert.equal(result.coverage, "PARTIAL_END");
    assert.ok(result.reasons[0].startsWith("end_gap_"));
  });

  test("PARTIAL_BOTH when neither edge is covered", () => {
    // default edgeToleranceMinutes=25; startGap=28min, endGap=28min -- both exceed tolerance.
    const ticks = [tick("2026-09-27T14:28:00.000Z", 1.0), tick("2026-09-27T14:32:00.000Z", 1.1)];
    const result = assessPositionCoverage({ committedAtMs: T("2026-09-27T14:00:00.000Z"), closedAtMs: T("2026-09-27T15:00:00.000Z"), ticks });
    assert.equal(result.coverage, "PARTIAL_BOTH");
  });

  test("GAPPY when edges are covered but one interior gap silently missed several cron cycles -- takes priority over edge classification since an interior gap can hide the exact exit-deciding tick", () => {
    const ticks = [
      tick("2026-09-27T14:02:00.000Z", 1.0),
      tick("2026-09-27T14:10:00.000Z", 1.1),
      tick("2026-09-27T15:20:00.000Z", 3.0), // 70min interior gap, exceeds the 60min ceiling (20min cadence x3)
      tick("2026-09-27T15:58:00.000Z", 2.5),
    ];
    const result = assessPositionCoverage({ committedAtMs: T("2026-09-27T14:00:00.000Z"), closedAtMs: T("2026-09-27T16:00:00.000Z"), ticks }, { cadenceMinutes: 20, interiorGapMultiple: 3 });
    assert.equal(result.coverage, "GAPPY");
    assert.ok(result.reasons.some((r) => r.startsWith("interior_gap_")));
    assert.equal(result.maxInteriorGapMinutes, 70);
  });

  test("a single missed cron tick (interior gap just under the ceiling) still counts FULL -- the ceiling tolerates ordinary cadence jitter, not an outage", () => {
    const ticks = [tick("2026-09-27T14:02:00.000Z", 1.0), tick("2026-09-27T14:41:00.000Z", 1.2), tick("2026-09-27T14:58:00.000Z", 1.3)];
    const result = assessPositionCoverage({ committedAtMs: T("2026-09-27T14:00:00.000Z"), closedAtMs: T("2026-09-27T15:00:00.000Z"), ticks }, { cadenceMinutes: 20, interiorGapMultiple: 3 });
    assert.equal(result.coverage, "FULL");
  });
});

describe("isLegitimateWeekendOrOvernightGap", () => {
  test("false for a same-ET-day gap", () => {
    assert.equal(isLegitimateWeekendOrOvernightGap(T("2026-09-28T14:00:00Z"), T("2026-09-28T15:00:00Z")), false);
  });

  test("true crossing an ordinary weekday-to-weekday overnight boundary", () => {
    assert.equal(isLegitimateWeekendOrOvernightGap(T("2026-09-28T19:55:00Z"), T("2026-09-29T13:35:00Z")), true);
  });

  test("true crossing Friday close -> Monday open", () => {
    // 2026-09-25 is a Friday, 2026-09-28 the following Monday.
    assert.equal(isLegitimateWeekendOrOvernightGap(T("2026-09-25T19:55:00Z"), T("2026-09-28T13:35:00Z")), true);
  });

  test("false when a real weekday is skipped entirely (a genuine outage, not a boundary)", () => {
    // Mon 9/28 -> Wed 9/30, skipping weekday Tue 9/29 with no ticks at all.
    assert.equal(isLegitimateWeekendOrOvernightGap(T("2026-09-28T19:55:00Z"), T("2026-09-30T13:35:00Z")), false);
  });

  test("false when B is before A", () => {
    assert.equal(isLegitimateWeekendOrOvernightGap(T("2026-09-28T19:55:00Z"), T("2026-09-25T13:35:00Z")), false);
  });

  test("DISCLOSED LIMITATION: does not know about mid-week market holidays -- a real one-day holiday skip still reads false (conservative, not a false pass)", () => {
    // 2026-11-26 is Thanksgiving (a real NYSE holiday); 11-25 Wed -> 11-27 Fri skips only that one
    // weekday. The authoritative TS port (holiday-aware) would exempt this; this approximation
    // does not -- and that is the documented, safe-direction tradeoff, not a bug to "fix" here.
    assert.equal(isLegitimateWeekendOrOvernightGap(T("2026-11-25T19:55:00Z"), T("2026-11-27T13:35:00Z")), false);
  });
});

describe("assessPositionCoverage -- RTH session-boundary fix (2026-09-27 phase-4 audit)", () => {
  test("FULL across a real overnight boundary with dense intraday ticks -- would have been GAPPY on raw wall-clock minutes", () => {
    const ticks = [
      tick("2026-09-28T13:35:00.000Z", 1.0), // day-1, near open
      tick("2026-09-28T13:45:00.000Z", 1.05), // day-1, +10min
      tick("2026-09-29T19:45:00.000Z", 1.3), // day-2, near close -- crosses the overnight boundary
      tick("2026-09-29T19:55:00.000Z", 1.5), // day-2, +10min
    ];
    const result = assessPositionCoverage({ committedAtMs: T("2026-09-28T13:33:00.000Z"), closedAtMs: T("2026-09-29T20:00:00.000Z"), ticks });
    assert.equal(result.coverage, "FULL");
    assert.equal(result.maxInteriorGapMinutes, 0); // the overnight jump is exempted, not counted
  });

  test("FULL across a real weekend boundary with dense intraday ticks", () => {
    const ticks = [
      tick("2026-09-25T13:35:00.000Z", 1.0), // Friday, near open
      tick("2026-09-25T13:45:00.000Z", 1.05), // Friday, +10min
      tick("2026-09-28T19:45:00.000Z", 1.2), // Monday, near close -- crosses the weekend boundary
      tick("2026-09-28T19:55:00.000Z", 1.3), // Monday, +10min
    ];
    const result = assessPositionCoverage({ committedAtMs: T("2026-09-25T13:33:00.000Z"), closedAtMs: T("2026-09-28T19:57:00.000Z"), ticks });
    assert.equal(result.coverage, "FULL");
  });

  test("GAPPY: a genuine multi-day outage that skips a real weekday is still flagged, not exempted", () => {
    const ticks = [
      tick("2026-09-28T13:35:00.000Z", 1.0), // Monday
      tick("2026-09-28T19:55:00.000Z", 1.1),
      tick("2026-09-30T13:35:00.000Z", 1.5), // Wednesday -- Tuesday has zero ticks
    ];
    const result = assessPositionCoverage({ committedAtMs: T("2026-09-28T13:33:00.000Z"), closedAtMs: T("2026-09-30T19:57:00.000Z"), ticks });
    assert.equal(result.coverage, "GAPPY");
  });

  test("default cadenceMinutes is now 5, matching the confirmed real deployed cron schedule (was an unverified 20min guess)", () => {
    // 18min same-day gap: under the OLD default (20min cadence x3 = 60min ceiling) this would read
    // FULL; under the corrected default (5min cadence x3 = 15min ceiling) it must read GAPPY.
    const ticks = [tick("2026-09-28T14:02:00.000Z", 1.0), tick("2026-09-28T14:20:00.000Z", 1.1), tick("2026-09-28T14:58:00.000Z", 1.2)];
    const result = assessPositionCoverage({ committedAtMs: T("2026-09-28T14:00:00.000Z"), closedAtMs: T("2026-09-28T15:00:00.000Z"), ticks });
    assert.equal(result.coverage, "GAPPY");
  });
});

describe("coverageEnvelopeOverlaps", () => {
  test("true when the aggregate coverage envelope brackets the position's lifecycle (within tolerance)", () => {
    const overlaps = coverageEnvelopeOverlaps(
      { committedAtMs: T("2026-09-27T14:00:00.000Z"), closedAtMs: T("2026-09-27T15:00:00.000Z") },
      { first_tick_at: "2026-09-27T13:55:00.000Z", last_tick_at: "2026-09-27T15:05:00.000Z" },
    );
    assert.equal(overlaps, true);
  });

  test("false when the position closed before the tick log ever saw this contract", () => {
    const overlaps = coverageEnvelopeOverlaps(
      { committedAtMs: T("2026-09-01T14:00:00.000Z"), closedAtMs: T("2026-09-01T15:00:00.000Z") },
      { first_tick_at: "2026-09-27T09:36:00.000Z", last_tick_at: "2026-09-27T20:00:00.000Z" },
    );
    assert.equal(overlaps, false);
  });

  test("false with no coverage row at all (never overlaps with nothing)", () => {
    assert.equal(coverageEnvelopeOverlaps({ committedAtMs: 1, closedAtMs: 2 }, null), false);
  });
});

describe("buildReadinessReport", () => {
  test("counts by bucket and gates readiness on the documented n=30 floor", () => {
    const assessed = [
      ...Array.from({ length: 25 }, () => ({ coverage: { coverage: "FULL" } })),
      { coverage: { coverage: "PARTIAL_START" } },
      { coverage: { coverage: "NONE" } },
    ];
    const report = buildReadinessReport(assessed);
    assert.equal(report.fullCoverageN, 25);
    assert.equal(report.totalClosedPositionsInWindow, 27);
    assert.equal(report.readyForVerdict, false);
    assert.equal(report.shortfall, 5);
  });

  test("readyForVerdict flips true once fullCoverageN reaches minVerifiedN", () => {
    const assessed = Array.from({ length: 30 }, () => ({ coverage: { coverage: "FULL" } }));
    const report = buildReadinessReport(assessed, { minVerifiedN: 30 });
    assert.equal(report.readyForVerdict, true);
    assert.equal(report.shortfall, 0);
  });

  test("empty population reports zero everywhere, not a crash", () => {
    const report = buildReadinessReport([]);
    assert.equal(report.totalClosedPositionsInWindow, 0);
    assert.equal(report.fullCoverageN, 0);
    assert.equal(report.readyForVerdict, false);
  });
});

describe("projectDaysToReadiness", () => {
  test("returns 0 once the shortfall is already closed", () => {
    assert.equal(projectDaysToReadiness(30, 30, 2), 0);
    assert.equal(projectDaysToReadiness(40, 30, 2), 0);
  });

  test("projects ceil(shortfall / dailyRate) days", () => {
    assert.equal(projectDaysToReadiness(10, 30, 2), 10); // 20 / 2 = 10
    assert.equal(projectDaysToReadiness(10, 30, 3), 7); // 20 / 3 = 6.67 -> 7
  });

  test("returns null (never Infinity/NaN) when the observed rate is non-positive -- an honest 'cannot project yet'", () => {
    assert.equal(projectDaysToReadiness(5, 30, 0), null);
    assert.equal(projectDaysToReadiness(5, 30, -1), null);
    assert.equal(projectDaysToReadiness(5, 30, NaN), null);
  });
});
