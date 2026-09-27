import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  mapDbTickToReplayTick,
  ticksToReplaySeries,
  assessPositionCoverage,
  coverageEnvelopeOverlaps,
  buildReadinessReport,
  projectDaysToReadiness,
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
