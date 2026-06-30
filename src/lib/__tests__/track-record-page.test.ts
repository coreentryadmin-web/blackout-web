import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pageSpxMatchesPublic } from "@/lib/track-record-page";
import type { PublicTrackRecord } from "@/lib/track-record-public";

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
});
