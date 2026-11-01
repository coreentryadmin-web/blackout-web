import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  isLegitimateSessionBoundaryGap,
  assessTickQuality,
  assessPositionCoverage,
  coverageEnvelopeOverlaps,
  buildReadinessReport,
  buildEligibilityReadiness,
  projectDaysToReadiness,
  DEFAULT_CADENCE_MINUTES,
  type CoverageBucket,
} from "./quote-tick-readiness";
import type { BangerQuoteTickLogRow, BangerQuoteTickCoverageRow } from "./quote-tick-log";

const T = (iso: string) => Date.parse(iso);

function tickRow(id: number, iso: string, reliableMark: number, opts: Partial<BangerQuoteTickLogRow> = {}): BangerQuoteTickLogRow {
  return {
    id,
    contract_occ: "O:TEST",
    polled_at: iso,
    bid: reliableMark,
    ask: reliableMark,
    last_trade: reliableMark,
    raw_mark: reliableMark,
    reliable_mark: reliableMark,
    ...opts,
  };
}

describe("isLegitimateSessionBoundaryGap", () => {
  test("false for a same-ET-day gap (the caller applies the ordinary cadence ceiling)", () => {
    assert.equal(isLegitimateSessionBoundaryGap(T("2026-09-28T14:00:00Z"), T("2026-09-28T15:00:00Z")), false);
  });

  test("true crossing Friday close -> Monday open (only weekend calendar days in between)", () => {
    // 2026-09-25 is a Friday, 2026-09-28 is the following Monday.
    assert.equal(isLegitimateSessionBoundaryGap(T("2026-09-25T19:55:00Z"), T("2026-09-28T13:35:00Z")), true);
  });

  test("true crossing one ordinary weekday-to-weekday overnight boundary", () => {
    assert.equal(isLegitimateSessionBoundaryGap(T("2026-09-28T19:55:00Z"), T("2026-09-29T13:35:00Z")), true);
  });

  test("false when a real trading day is skipped entirely with zero ticks on it (a genuine outage, not a boundary)", () => {
    // Mon 9/28 -> Wed 9/30, skipping real trading day Tue 9/29 with no ticks at all.
    assert.equal(isLegitimateSessionBoundaryGap(T("2026-09-28T19:55:00Z"), T("2026-09-30T13:35:00Z")), false);
  });

  test("false when B is before A (out of order)", () => {
    assert.equal(isLegitimateSessionBoundaryGap(T("2026-09-28T19:55:00Z"), T("2026-09-25T13:35:00Z")), false);
  });
});

describe("assessTickQuality", () => {
  test("clean series: no duplicates, backstop ratio reflects raw!=reliable divergence", () => {
    const rows = [
      tickRow(1, "2026-09-28T14:00:00Z", 1.0),
      tickRow(2, "2026-09-28T14:05:00Z", 1.1, { raw_mark: 5.0 }), // backstop fired (PR #4969 shape)
      tickRow(3, "2026-09-28T14:10:00Z", 1.2),
    ];
    const { quality, cleanedTicks } = assessTickQuality(rows);
    assert.equal(quality.tickCount, 3);
    assert.equal(quality.duplicateTimestampCount, 0);
    assert.equal(quality.duplicateConflictCount, 0);
    assert.equal(quality.backstopFiredCount, 1);
    assert.equal(quality.backstopFiredRatio, 1 / 3);
    assert.equal(cleanedTicks.length, 3);
  });

  test("duplicate timestamp with agreeing marks: deduped, no conflict flagged", () => {
    const rows = [tickRow(1, "2026-09-28T14:00:00Z", 1.0), tickRow(2, "2026-09-28T14:00:00Z", 1.0)];
    const { quality, cleanedTicks } = assessTickQuality(rows);
    assert.equal(quality.duplicateTimestampCount, 1);
    assert.equal(quality.duplicateConflictCount, 0);
    assert.equal(cleanedTicks.length, 1);
  });

  test("duplicate timestamp with DISAGREEING marks: flagged as a conflict, later row (higher id) wins", () => {
    const rows = [tickRow(1, "2026-09-28T14:00:00Z", 1.0), tickRow(2, "2026-09-28T14:00:00Z", 5.0)];
    const { quality, cleanedTicks } = assessTickQuality(rows);
    assert.equal(quality.duplicateConflictCount, 1);
    assert.equal(cleanedTicks.length, 1);
    assert.equal(cleanedTicks[0]!.mark, 5.0);
  });

  test("a row with no reliable_mark is skipped entirely, never fabricated", () => {
    const rows = [tickRow(1, "2026-09-28T14:00:00Z", 1.0, { reliable_mark: null }), tickRow(2, "2026-09-28T14:05:00Z", 1.1)];
    const { quality, cleanedTicks } = assessTickQuality(rows);
    assert.equal(quality.tickCount, 1);
    assert.equal(cleanedTicks.length, 1);
  });

  test("empty input: zero counts, null ratio, never NaN/crash", () => {
    const { quality, cleanedTicks } = assessTickQuality([]);
    assert.equal(quality.tickCount, 0);
    assert.equal(quality.backstopFiredRatio, null);
    assert.deepEqual(cleanedTicks, []);
  });
});

describe("assessPositionCoverage", () => {
  test("FULL: edges covered, no abnormal interior gap", () => {
    // Every adjacent gap must clear the default cadence ceiling (5min * 3 = 15min) -- 12min steps.
    const rows = [
      tickRow(1, "2026-09-28T14:02:00Z", 1.0),
      tickRow(2, "2026-09-28T14:14:00Z", 1.1),
      tickRow(3, "2026-09-28T14:26:00Z", 1.2),
      tickRow(4, "2026-09-28T14:38:00Z", 1.3),
    ];
    const result = assessPositionCoverage({ committedAtMs: T("2026-09-28T14:00:00Z"), closedAtMs: T("2026-09-28T15:00:00Z"), rawTickRows: rows });
    assert.equal(result.coverage, "FULL");
    assert.deepEqual(result.reasons, []);
  });

  test("FULL across a real overnight session boundary -- the exact bug this port fixes (would have been GAPPY on raw wall-clock minutes)", () => {
    // Two closely-spaced ticks per session day (10min apart, well under the 15min ceiling) so the
    // ONLY gap that needs the session-boundary exemption is the day-1-close -> day-2-open jump.
    const rows = [
      tickRow(1, "2026-09-28T13:35:00Z", 1.0), // day-1, near open
      tickRow(2, "2026-09-28T13:45:00Z", 1.05), // day-1, +10min
      tickRow(3, "2026-09-29T19:45:00Z", 1.3), // day-2, near close -- crosses the overnight boundary
      tickRow(4, "2026-09-29T19:55:00Z", 1.5), // day-2, +10min
    ];
    const result = assessPositionCoverage({ committedAtMs: T("2026-09-28T13:33:00Z"), closedAtMs: T("2026-09-29T20:00:00Z"), rawTickRows: rows });
    assert.equal(result.coverage, "FULL");
    assert.equal(result.maxInteriorGapMinutes, 0); // the overnight jump is exempted, not counted
  });

  test("FULL across a real weekend session boundary (Friday close -> Monday open)", () => {
    const rows = [
      tickRow(1, "2026-09-25T13:35:00Z", 1.0), // Friday, near open
      tickRow(2, "2026-09-25T13:45:00Z", 1.05), // Friday, +10min
      tickRow(3, "2026-09-28T19:45:00Z", 1.2), // Monday, near close -- crosses the weekend boundary
      tickRow(4, "2026-09-28T19:55:00Z", 1.3), // Monday, +10min
    ];
    const result = assessPositionCoverage({ committedAtMs: T("2026-09-25T13:33:00Z"), closedAtMs: T("2026-09-28T19:57:00Z"), rawTickRows: rows });
    assert.equal(result.coverage, "FULL");
  });

  test("GAPPY: a real intraday gap larger than the cadence ceiling, same trading day", () => {
    const rows = [
      tickRow(1, "2026-09-28T14:02:00Z", 1.0),
      tickRow(2, "2026-09-28T14:10:00Z", 1.1),
      tickRow(3, "2026-09-28T14:57:00Z", 3.0), // 47min gap, same day, exceeds default 5*3=15min ceiling
    ];
    const result = assessPositionCoverage({ committedAtMs: T("2026-09-28T14:00:00Z"), closedAtMs: T("2026-09-28T15:00:00Z"), rawTickRows: rows });
    assert.equal(result.coverage, "GAPPY");
    assert.ok(result.reasons.some((r) => r.startsWith("interior_gap_")));
  });

  test("GAPPY: a real outage that skips a full trading day (not exempted by the session-boundary check)", () => {
    const rows = [
      tickRow(1, "2026-09-28T13:35:00Z", 1.0), // Monday
      tickRow(2, "2026-09-28T19:55:00Z", 1.1),
      tickRow(3, "2026-09-30T13:35:00Z", 1.5), // Wednesday -- Tuesday (a real trading day) has zero ticks
    ];
    const result = assessPositionCoverage({ committedAtMs: T("2026-09-28T13:33:00Z"), closedAtMs: T("2026-09-30T19:57:00Z"), rawTickRows: rows });
    assert.equal(result.coverage, "GAPPY");
  });

  test("NONE: no ticks at all", () => {
    const result = assessPositionCoverage({ committedAtMs: T("2026-09-28T14:00:00Z"), closedAtMs: T("2026-09-28T15:00:00Z"), rawTickRows: [] });
    assert.equal(result.coverage, "NONE");
    assert.deepEqual(result.reasons, ["no_ticks_in_window"]);
  });

  test("NONE: invalid lifecycle window", () => {
    const result = assessPositionCoverage({ committedAtMs: T("2026-09-28T15:00:00Z"), closedAtMs: T("2026-09-28T14:00:00Z"), rawTickRows: [] });
    assert.equal(result.coverage, "NONE");
    assert.deepEqual(result.reasons, ["invalid_lifecycle_window"]);
  });

  test("DUPLICATE_CONFLICT: excludes an otherwise-clean position when same-timestamp rows disagree", () => {
    const rows = [
      tickRow(1, "2026-09-28T14:02:00Z", 1.0),
      tickRow(2, "2026-09-28T14:30:00Z", 1.3),
      tickRow(3, "2026-09-28T14:30:00Z", 9.0), // conflicting duplicate
      tickRow(4, "2026-09-28T14:58:00Z", 1.4),
    ];
    const result = assessPositionCoverage({ committedAtMs: T("2026-09-28T14:00:00Z"), closedAtMs: T("2026-09-28T15:00:00Z"), rawTickRows: rows });
    assert.equal(result.coverage, "DUPLICATE_CONFLICT");
    assert.ok(result.reasons.some((r) => r.startsWith("duplicate_tick_conflict_")));
  });

  test("BACKSTOP_HEAVY: excludes a position whose marks were mostly last-trade fallbacks, not real two-sided quotes", () => {
    const rows = [
      tickRow(1, "2026-09-28T14:02:00Z", 1.0, { raw_mark: 5.0 }),
      tickRow(2, "2026-09-28T14:20:00Z", 1.1, { raw_mark: 5.5 }),
      tickRow(3, "2026-09-28T14:40:00Z", 1.2, { raw_mark: 6.0 }),
      tickRow(4, "2026-09-28T14:58:00Z", 1.3), // only 1/4 clean
    ];
    const result = assessPositionCoverage({ committedAtMs: T("2026-09-28T14:00:00Z"), closedAtMs: T("2026-09-28T15:00:00Z"), rawTickRows: rows });
    assert.equal(result.coverage, "BACKSTOP_HEAVY");
    assert.ok(result.reasons.some((r) => r.startsWith("backstop_fallback_ratio_")));
  });

  test("respects a custom cadenceMinutes (matters if the deployed schedule ever changes)", () => {
    const rows = [tickRow(1, "2026-09-28T14:02:00Z", 1.0), tickRow(2, "2026-09-28T14:20:00Z", 1.1), tickRow(3, "2026-09-28T14:58:00Z", 1.2)];
    const strict = assessPositionCoverage(
      { committedAtMs: T("2026-09-28T14:00:00Z"), closedAtMs: T("2026-09-28T15:00:00Z"), rawTickRows: rows },
      { cadenceMinutes: 1, interiorGapMultiple: 3 }, // ceiling = 3min, the 18min real gap now exceeds it
    );
    assert.equal(strict.coverage, "GAPPY");
    assert.notEqual(DEFAULT_CADENCE_MINUTES, 1);
  });
});

describe("coverageEnvelopeOverlaps", () => {
  const coverage: BangerQuoteTickCoverageRow = { contract_occ: "O:TEST", tick_count: 10, first_tick_at: "2026-09-28T13:55:00Z", last_tick_at: "2026-09-28T20:05:00Z" };
  test("true when the aggregate envelope brackets the lifecycle within tolerance", () => {
    assert.equal(coverageEnvelopeOverlaps({ committedAtMs: T("2026-09-28T14:00:00Z"), closedAtMs: T("2026-09-28T20:00:00Z") }, coverage), true);
  });
  test("false when the position predates the log's own coverage entirely", () => {
    assert.equal(coverageEnvelopeOverlaps({ committedAtMs: T("2026-09-01T14:00:00Z"), closedAtMs: T("2026-09-01T20:00:00Z") }, coverage), false);
  });
  test("false with no coverage row", () => {
    assert.equal(coverageEnvelopeOverlaps({ committedAtMs: 1, closedAtMs: 2 }, undefined), false);
  });
});

describe("buildReadinessReport", () => {
  test("counts every bucket, gates on the n>=30 floor by default", () => {
    const buckets: CoverageBucket[] = [...Array(25).fill("FULL"), "GAPPY", "NONE", "BACKSTOP_HEAVY"];
    const report = buildReadinessReport(buckets);
    assert.equal(report.fullCoverageN, 25);
    assert.equal(report.totalClosedPositionsInWindow, 28);
    assert.equal(report.readyForVerdict, false);
    assert.equal(report.shortfall, 5);
    assert.equal(report.byBucket.GAPPY, 1);
    assert.equal(report.byBucket.BACKSTOP_HEAVY, 1);
  });

  test("readyForVerdict flips true at exactly n=30", () => {
    const buckets: CoverageBucket[] = Array(30).fill("FULL");
    assert.equal(buildReadinessReport(buckets).readyForVerdict, true);
  });
});

describe("buildEligibilityReadiness", () => {
  test("counts only TRUE flags as eligible, gates on n>=30 by default", () => {
    const flags = [...Array(29).fill(true), false, false];
    const report = buildEligibilityReadiness(flags);
    assert.equal(report.totalClosedPositionsInWindow, 31);
    assert.equal(report.eligibleN, 29);
    assert.equal(report.readyForVerdict, false);
    assert.equal(report.shortfall, 1);
  });

  test("readyForVerdict flips true at exactly n=30 eligible", () => {
    const flags = Array(30).fill(true);
    assert.equal(buildEligibilityReadiness(flags).readyForVerdict, true);
  });

  test("a FULL-coverage position that fails the scaled-flag cross-check is NOT counted eligible", () => {
    // e.g. 32 positions have FULL tick coverage, but 3 of those disagree with the recorded
    // scaled_already flag -- only the remaining 29 are truly eligible, still short of 30.
    const flags = [...Array(29).fill(true), ...Array(3).fill(false)];
    const report = buildEligibilityReadiness(flags);
    assert.equal(report.eligibleN, 29);
    assert.equal(report.readyForVerdict, false);
  });
});

describe("projectDaysToReadiness", () => {
  test("0 once the shortfall is closed", () => {
    assert.equal(projectDaysToReadiness(30, 30, 2), 0);
  });
  test("ceil(shortfall / rate)", () => {
    assert.equal(projectDaysToReadiness(10, 30, 3), 7);
  });
  test("null (never Infinity/NaN) when the rate can't be measured", () => {
    assert.equal(projectDaysToReadiness(5, 30, 0), null);
    assert.equal(projectDaysToReadiness(5, 30, null), null);
  });
});
