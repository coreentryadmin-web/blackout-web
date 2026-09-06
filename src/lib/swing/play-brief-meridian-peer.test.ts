import test from "node:test";
import assert from "node:assert/strict";
import { meridianPeerEarningsCoaching, pickEarningsForSwingPeer } from "./play-brief-meridian-peer-core";
import type { LargoTimelineItem } from "@/lib/largo/meridian-timeline-for-largo";

function earningsItem(overrides: Partial<LargoTimelineItem> = {}): LargoTimelineItem {
  return {
    id: "earnings:BBWI:2026-09-10",
    kind: "earnings",
    title: "BBWI earnings",
    subtitle: null,
    date: "2026-09-10",
    time: null,
    impact: "high",
    days_until: 4,
    ticker: "BBWI",
    date_status: null,
    importance: 3,
    is_printed: false,
    expected_move_pct: 8.5,
    sector_label: "Retail",
    ...overrides,
  };
}

test("meridianPeerEarningsCoaching: implied move without peer cohort", () => {
  const line = meridianPeerEarningsCoaching(null, earningsItem());
  assert.match(line!, /Earnings peer lens/i);
  assert.match(line!, /8\.5%/);
});

test("meridianPeerEarningsCoaching: peer beat rates when cohort available", () => {
  const line = meridianPeerEarningsCoaching(
    {
      available: true,
      id: "earnings:BBWI:2026-09-10",
      subject_ticker: "BBWI",
      position_summary: "Implied move ranks 75th pctile vs peers",
      members: [
        {
          ticker: "BBWI",
          report_date: "2026-09-10",
          expected_move_pct: 8.5,
          avg_reaction_pct: null,
          reaction_sample_n: 0,
          beat_rate: null,
          beat_rate_n: 0,
          is_subject: true,
        },
        {
          ticker: "ULTA",
          report_date: "2026-09-05",
          expected_move_pct: 6,
          avg_reaction_pct: -2,
          reaction_sample_n: 4,
          beat_rate: 0.75,
          beat_rate_n: 4,
          is_subject: false,
        },
      ],
      interpretation: "",
      sector_label: "Retail",
      major_group: "52",
      distribution: null,
      insufficient_reason: null,
    },
    earningsItem(),
  );
  assert.match(line!, /ULTA/i);
  assert.match(line!, /75% beat/i);
});

test("meridianPeerEarningsCoaching: surfaces sector_label and interpretation", () => {
  const line = meridianPeerEarningsCoaching(
    {
      available: true,
      id: "earnings:BBWI:2026-09-10",
      subject_ticker: "BBWI",
      position_summary: null,
      members: [],
      interpretation: "Implied move sits in the top quartile vs retail peers.",
      sector_label: "Retail",
      major_group: "52",
      distribution: null,
      insufficient_reason: null,
    },
    earningsItem(),
  );
  assert.match(line!, /sector \*\*Retail\*\*/i);
  assert.match(line!, /top quartile/i);
});

test("pickEarningsForSwingPeer: skips index tickers (market-wide catalyst slice)", () => {
  const items = [earningsItem({ ticker: "AAPL", days_until: 3 })];
  assert.equal(pickEarningsForSwingPeer(items, "SPY"), null);
});

test("pickEarningsForSwingPeer: requires earnings ticker to match swing under review", () => {
  const items = [earningsItem({ ticker: "AAPL", days_until: 3 })];
  assert.equal(pickEarningsForSwingPeer(items, "NVDA"), null);
  assert.equal(pickEarningsForSwingPeer(items, "AAPL")?.ticker, "AAPL");
});
