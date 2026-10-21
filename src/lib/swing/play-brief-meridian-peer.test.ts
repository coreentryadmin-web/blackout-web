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

// BUG FIX (2026-10-20, Ask Largo standing mandate — live fresh-angle audit). Up to
// MAX_PEER_REACTION_TICKERS=6 non-subject peers can clear the beat_rate_n>=3 floor this function
// applies, but the old code did a bare `.slice(0, 3)` with no disclosure that the cohort was
// actually larger — a Largo C3 absence-disclosure violation, the same shape already fixed the
// same day in play-brief-diff.ts.
test("meridianPeerEarningsCoaching: more than 3 qualifying peers discloses the overflow instead of silently dropping it", () => {
  function peerMember(ticker: string, beatRate: number, beatRateN: number) {
    return {
      ticker,
      report_date: "2026-09-05",
      expected_move_pct: 6,
      avg_reaction_pct: -2,
      reaction_sample_n: beatRateN,
      beat_rate: beatRate,
      beat_rate_n: beatRateN,
      is_subject: false,
    };
  }
  const line = meridianPeerEarningsCoaching(
    {
      available: true,
      id: "earnings:BBWI:2026-09-10",
      subject_ticker: "BBWI",
      position_summary: null,
      members: [
        peerMember("ULTA", 0.75, 4),
        peerMember("TJX", 0.6, 5),
        peerMember("ROST", 0.5, 6),
        peerMember("GPS", 0.4, 4),
        peerMember("ANF", 0.3, 3),
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
  assert.match(line!, /TJX/i);
  assert.match(line!, /ROST/i);
  assert.doesNotMatch(line!, /GPS/i, "only the first 3 peers should be named inline");
  assert.doesNotMatch(line!, /ANF/i, "only the first 3 peers should be named inline");
  assert.match(
    line!,
    /\+2 more peers not shown/i,
    "the 2 dropped peers (GPS, ANF) must be disclosed as an overflow count, not silently dropped",
  );
});

test("meridianPeerEarningsCoaching: surfaces the SUBJECT ticker's own beat rate/reaction, not just peers'", () => {
  const line = meridianPeerEarningsCoaching(
    {
      available: true,
      id: "earnings:BBWI:2026-09-10",
      subject_ticker: "BBWI",
      position_summary: null,
      members: [
        {
          ticker: "BBWI",
          report_date: "2026-05-10",
          expected_move_pct: 8.5,
          avg_reaction_pct: 3.2,
          reaction_sample_n: 5,
          beat_rate: 0.8,
          beat_rate_n: 5,
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
  // The subject's own history must be present (this is the whole point of the fix)...
  assert.match(line!, /this ticker's own print history: 80% beat/i);
  assert.match(line!, /avg reaction \*\*\+3\.2%\*\* \(n=5\)/);
  // ...alongside, not instead of, the peer history that already worked.
  assert.match(line!, /ULTA/i);
  assert.match(line!, /75% beat/i);
});

test("meridianPeerEarningsCoaching: omits the subject's own line when its sample is thin (never fabricates a rate)", () => {
  const line = meridianPeerEarningsCoaching(
    {
      available: true,
      id: "earnings:BBWI:2026-09-10",
      subject_ticker: "BBWI",
      position_summary: null,
      members: [
        {
          ticker: "BBWI",
          report_date: "2026-05-10",
          expected_move_pct: 8.5,
          avg_reaction_pct: 3.2,
          reaction_sample_n: 2,
          beat_rate: 1,
          beat_rate_n: 2,
          is_subject: true,
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
  assert.doesNotMatch(line!, /own print history/i);
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

test("meridianPeerEarningsCoaching: thin cohort caveat when insufficient_reason is set", () => {
  const line = meridianPeerEarningsCoaching(
    {
      available: true,
      id: "earnings:BBWI:2026-09-10",
      subject_ticker: "BBWI",
      position_summary: null,
      members: [
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
      insufficient_reason: "only 1 peer with implied move",
    },
    earningsItem(),
  );
  assert.match(line!, /Implied-move cohort thin/i);
  assert.match(line!, /only 1 peer with implied move/i);
  assert.match(line!, /directional only/i);
});

test("meridianPeerEarningsCoaching: thin cohort does not state the insufficient reason twice (Largo C8 narrative quality, live repro TSLA:60)", () => {
  // Real production shape: shapeMeridianPeerCohortForLargo sets BOTH position_summary (via
  // describeCohortPosition, which returns "${label} — ${insufficientReason}" when distribution is
  // null) and insufficient_reason from the SAME cohort.insufficientReason — they are coupled 1:1,
  // unlike the hand-built fixture above which sets position_summary: null by hand.
  const reason = "no peers reporting with a comparable number — too few to rank against";
  const line = meridianPeerEarningsCoaching(
    {
      available: true,
      id: "earnings:TSLA:2026-10-21",
      subject_ticker: "TSLA",
      position_summary: `Transportation Equipment — ${reason}`,
      members: [
        {
          ticker: "WGO",
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
      sector_label: "Transportation Equipment",
      major_group: "37",
      distribution: null,
      insufficient_reason: reason,
    },
    earningsItem({ ticker: "TSLA" }),
  );
  const occurrences = line!.split(reason).length - 1;
  assert.equal(occurrences, 1, `expected the insufficient-cohort reason to appear exactly once, got ${occurrences} in: ${line}`);
  assert.match(line!, /Implied-move cohort thin/i);
});

// BUG FIX (2026-10-21, Ask Largo standing mandate, live repro SHOP — 13 days to print, peer cohort
// unavailable, no expected_move_pct quoted). The function's own entry gate (line 57) accepts any
// earnings item with days_until in [0,14], but the baseline "reports in Nd" line that's otherwise
// the ONLY thing standing between an empty `parts` array and a rendered section was gated at
// `days_until <= 7` — a narrower sub-window left over from before the entry gate was widened to 14
// days. TDOC/GOOGL (days_until === 7) got the thin fallback section; SHOP (days_until === 13) got
// no section at all, with the identical "peer cohort unavailable" condition. Live cross-ticker
// comparison in the same audit cycle caught this as the one structurally different ticker in the
// 8-14-day sub-range.
test("meridianPeerEarningsCoaching: 8-14 days out with no implied move and no peer cohort still renders the thin fallback, not a silent omission (live repro SHOP)", () => {
  const line = meridianPeerEarningsCoaching(
    { available: false, error: "unclassified_sector" },
    earningsItem({ ticker: "SHOP", days_until: 13, expected_move_pct: null }),
  );
  assert.ok(line, "an earnings item 13 days out must still render a thin fallback, not return null");
  assert.match(line!, /Earnings peer lens/i);
  assert.match(line!, /reports in \*\*13d\*\*/i);
});

test("meridianPeerEarningsCoaching: within 3 days still gets the 'print imminent' emphasis alongside the baseline line (no regression)", () => {
  const line = meridianPeerEarningsCoaching(null, earningsItem({ days_until: 2, expected_move_pct: null }));
  assert.match(line!, /reports in \*\*2d\*\*/i);
  assert.match(line!, /print imminent/i);
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
