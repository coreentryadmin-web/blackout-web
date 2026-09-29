import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isPremarketBriefFresh,
  priorDayFromDailyBars,
  widenSessionExtremesWithSpot,
} from "./spx-session";

describe("widenSessionExtremesWithSpot", () => {
  it("widens HOD/LOD to include live spot during RTH", () => {
    const { hod, lod } = widenSessionExtremesWithSpot(7440.43, 7392.95, 7294.18, true);
    assert.equal(hod, 7440.43);
    assert.equal(lod, 7294.18);
  });

  it("does not fabricate extremes from spot when HOD/LOD are null", () => {
    const { hod, lod } = widenSessionExtremesWithSpot(7440.43, null, null, true);
    assert.equal(hod, null);
    assert.equal(lod, null);
  });

  it("leaves extremes unchanged when market is closed", () => {
    const { hod, lod } = widenSessionExtremesWithSpot(7440.43, 7392.95, 7294.18, false);
    assert.equal(hod, 7392.95);
    assert.equal(lod, 7294.18);
  });
});

describe("priorDayFromDailyBars", () => {
  // noon ET keeps the bar unambiguously on its calendar date regardless of conversion
  const bar = (ymd: string, h: number, l: number, c: number) => ({
    t: Date.parse(`${ymd}T12:00:00-04:00`),
    o: 0,
    h,
    l,
    c,
  });

  it("off-hours: returns the last COMPLETED session, not the one before it", () => {
    // Pre-market 2026-07-01 with no partial bar yet: 06-30 is the prior session.
    // (Regression: the old bars[length-2] logic returned the stale 06-29 values here.)
    const bars = [
      bar("2026-06-29", 7444.32, 7348.88, 7440.43),
      bar("2026-06-30", 7508.29, 7438.04, 7499.36),
    ];
    assert.deepEqual(priorDayFromDailyBars(bars, "2026-07-01"), {
      pdh: 7508.29,
      pdl: 7438.04,
      pdc: 7499.36,
    });
  });

  it("RTH: skips today's in-progress partial bar", () => {
    const bars = [
      bar("2026-06-29", 7444.32, 7348.88, 7440.43),
      bar("2026-06-30", 7508.29, 7438.04, 7499.36),
      bar("2026-07-01", 7510, 7490, 7505), // today's partial
    ];
    assert.deepEqual(priorDayFromDailyBars(bars, "2026-07-01"), {
      pdh: 7508.29,
      pdl: 7438.04,
      pdc: 7499.36,
    });
  });

  it("post-close same day: anchorSessionComplete returns TODAY's own settled bar, not yesterday's (2026-09-12 live bug)", () => {
    // Reproduces the live 2026-09-12 SPX cold-replica bug: a cold replica booting AFTER
    // Friday's own 4pm ET close (still "today" in ET calendar terms until midnight) served
    // Thursday's close as the current SPX price because the default (anchorSessionComplete
    // omitted/false) always treats "today"'s own bar as in-progress and skips it — correct
    // pre-market/RTH, wrong once the session has genuinely ended. Numbers match the live
    // incident: Thu 2026-09-10 close 7591.7, Fri 2026-09-11 close 7656.98.
    const bars = [
      bar("2026-09-10", 7620.11, 7580.02, 7591.7), // Thu
      bar("2026-09-11", 7677.02, 7636.75, 7656.98), // Fri — today's own now-COMPLETE session
    ];
    // RED (pre-fix behavior, still correct default): without the flag, today's own bar is
    // skipped and the stale prior day is returned.
    assert.deepEqual(priorDayFromDailyBars(bars, "2026-09-11"), {
      pdh: 7620.11,
      pdl: 7580.02,
      pdc: 7591.7,
    });
    // GREEN (the fix): a caller that knows today's own session has already closed passes
    // `anchorSessionComplete: true` and gets today's own settled close instead.
    assert.deepEqual(priorDayFromDailyBars(bars, "2026-09-11", true), {
      pdh: 7677.02,
      pdl: 7636.75,
      pdc: 7656.98,
    });
  });

  it("handles weekend gaps (Monday 06-29 -> prior Friday 06-26)", () => {
    const bars = [
      bar("2026-06-25", 7419.08, 7323.5, 7357.49),
      bar("2026-06-26", 7392.95, 7294.18, 7354.02),
    ];
    assert.deepEqual(priorDayFromDailyBars(bars, "2026-06-29"), {
      pdh: 7392.95,
      pdl: 7294.18,
      pdc: 7354.02,
    });
  });

  it("returns nulls when only today's partial bar exists", () => {
    assert.deepEqual(
      priorDayFromDailyBars([bar("2026-07-01", 7510, 7490, 7505)], "2026-07-01"),
      { pdh: null, pdl: null, pdc: null }
    );
  });

  it("returns nulls for empty input", () => {
    assert.deepEqual(priorDayFromDailyBars([], "2026-07-01"), {
      pdh: null,
      pdl: null,
      pdc: null,
    });
  });

  it("displayed-session anchor: returns the session strictly BEFORE the anchor, never the anchor session itself", () => {
    // Weekend / pre-open case behind the Vector prior-day fix (2026-07-14): the chart displays
    // FRIDAY as its latest seeded session. Anchoring the walk-back to the real wall-clock date
    // (Sat "2026-07-11") returns Friday — the displayed session's own H/L/C, drawing PDH/PDL on
    // the very candles being viewed. Anchoring to the DISPLAYED session ("2026-07-10", the
    // chart's sessionYmd) returns Thursday, the genuine prior day.
    const bars = [
      bar("2026-07-09", 7472.11, 7401.55, 7455.02), // Thu
      bar("2026-07-10", 7508.29, 7438.04, 7499.36), // Fri — the displayed session
    ];
    assert.deepEqual(priorDayFromDailyBars(bars, "2026-07-10"), {
      pdh: 7472.11,
      pdl: 7401.55,
      pdc: 7455.02,
    });
    // The unanchored (wall-clock Saturday) walk-back that motivated the anchor param:
    assert.deepEqual(priorDayFromDailyBars(bars, "2026-07-11"), {
      pdh: 7508.29,
      pdl: 7438.04,
      pdc: 7499.36,
    });
  });

  it("falls back to bars[length-2] when timestamps are absent", () => {
    const bars = [
      { o: 0, h: 10, l: 5, c: 8 },
      { o: 0, h: 12, l: 6, c: 9 },
    ];
    assert.deepEqual(priorDayFromDailyBars(bars, "2026-07-01"), {
      pdh: 10,
      pdl: 5,
      pdc: 8,
    });
  });
});

describe("isPremarketBriefFresh", () => {
  it("is fresh when the brief date is today", () => {
    assert.equal(isPremarketBriefFresh("2026-07-01", "2026-07-01"), true);
  });

  it("is fresh when the brief is exactly 1 calendar day old (premarket brief published using yesterday's close)", () => {
    assert.equal(isPremarketBriefFresh("2026-06-30", "2026-07-01"), true);
  });

  it("is stale when the brief is 2+ days old", () => {
    assert.equal(isPremarketBriefFresh("2026-06-28", "2026-07-01"), false);
  });

  it("reports the exact reported bug case as stale (2026-06-29 brief served during 2026-07-01 RTH)", () => {
    assert.equal(isPremarketBriefFresh("2026-06-29", "2026-07-01"), false);
  });

  it("is stale for a brief dated in the future relative to today (clock skew / bad row)", () => {
    assert.equal(isPremarketBriefFresh("2026-07-02", "2026-07-01"), false);
  });
});
