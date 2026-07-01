import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { nhFromRows, pageSpxMatchesPublic } from "@/lib/track-record-page";
import type { PublicTrackRecord } from "@/lib/track-record-public";
import type { NighthawkPlayOutcomeRow } from "@/lib/db";

function nhRow(overrides: Partial<NighthawkPlayOutcomeRow>): NighthawkPlayOutcomeRow {
  return {
    id: 1,
    edition_for: "2026-06-30",
    ticker: "TEST",
    direction: "LONG",
    conviction: "high",
    entry_range_low: null,
    entry_range_high: null,
    target: null,
    stop: null,
    score: null,
    sector: null,
    next_day_open: null,
    next_day_close: null,
    session_high: null,
    session_low: null,
    hit_target: false,
    hit_stop: false,
    outcome: "target",
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

describe("track-record-page", () => {
  it("pageSpxMatchesPublic agrees when SPX block matches public ledger", () => {
    const pub: PublicTrackRecord = {
      available: true,
      generated_at: new Date().toISOString(),
      total_closed: 3,
      days_of_data: 1,
      win_rate_pct: 0,
      wins: 0,
      losses: 3,
      breakeven: 0,
      paths: {
        cold_buy: { count: 1, win_rate_pct: 0, avg_mfe_pts: 0 },
        watch_promote: { count: 2, win_rate_pct: 0, avg_mfe_pts: 0 },
      },
      adaptive_active: false,
      summary: "test",
    };
    const page = {
      spxSlayer: { total: 3, wins: 0, losses: 3, winRatePct: 0 },
      nightHawk: {
        total: 0,
        wins: 0,
        losses: 0,
        winRatePct: null,
        avgWinnerPct: null,
        avgLoserPct: null,
        profitFactor: null,
      },
      methodology: "",
      liveData: true,
    };
    assert.equal(pageSpxMatchesPublic(page, pub), true);
  });

  it("pageSpxMatchesPublic flags split-brain mismatch", () => {
    const pub: PublicTrackRecord = {
      available: true,
      generated_at: new Date().toISOString(),
      total_closed: 3,
      days_of_data: 1,
      win_rate_pct: 0,
      wins: 0,
      losses: 3,
      breakeven: 0,
      paths: {
        cold_buy: { count: 0, win_rate_pct: 0, avg_mfe_pts: 0 },
        watch_promote: { count: 0, win_rate_pct: 0, avg_mfe_pts: 0 },
      },
      adaptive_active: false,
      summary: "test",
    };
    const page = {
      spxSlayer: { total: 0, wins: 0, losses: 0, winRatePct: null },
      nightHawk: {
        total: 0,
        wins: 0,
        losses: 0,
        winRatePct: null,
        avgWinnerPct: null,
        avgLoserPct: null,
        profitFactor: null,
      },
      methodology: "",
      liveData: true,
    };
    assert.equal(pageSpxMatchesPublic(page, pub), false);
  });

  it("nhFromRows excludes a corrupt entry range from winner stats instead of corrupting them", () => {
    // Corrupt row: entry_range_low=17 is a garbage placeholder against a stock
    // trading near $450 — the range width is wildly outside a plausible intraday
    // band. Should be dropped from the return math entirely (not clamped/averaged in).
    const corruptWinner = nhRow({
      id: 1,
      entry_range_low: 17,
      entry_range_high: 448,
      outcome: "target",
      next_day_close: 450,
    });
    // Normal tight-range winner: legitimate published entry zone, should be counted.
    const normalWinner = nhRow({
      id: 2,
      entry_range_low: 443,
      entry_range_high: 447,
      outcome: "target",
      next_day_close: 452,
    });

    const corruptOnly = nhFromRows([corruptWinner]);
    assert.equal(corruptOnly.avgWinnerPct, null, "corrupt row alone must not produce a winner return");
    assert.equal(corruptOnly.profitFactor, null, "corrupt row alone must not produce a profit factor");

    const mixed = nhFromRows([corruptWinner, normalWinner]);
    // entry_mid = (443+447)/2 = 445; return = (452-445)/445*100 ≈ 1.573% → rounds to 1.6
    assert.equal(mixed.avgWinnerPct, 1.6, "avgWinnerPct should reflect only the legitimate row");
    assert.equal(
      mixed.profitFactor,
      null,
      "profitFactor should stay null (no loser rows), not an absurd value driven by the corrupt row"
    );
  });
});
