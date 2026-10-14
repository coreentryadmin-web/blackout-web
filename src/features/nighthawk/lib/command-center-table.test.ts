import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCommandCenterTable } from "./command-center-table";
import type { PlaybookPlay } from "./types";
import type { CandidateLeaderboardEntry, CandidateLeaderboardStagePoint } from "./candidate-leaderboard";
import type { MarketRegimeTag } from "./market-regime";

function play(overrides: Partial<PlaybookPlay>): PlaybookPlay {
  return {
    rank: 1,
    ticker: "NVDA",
    direction: "bullish",
    conviction: "high",
    play_type: "stock",
    thesis: "thesis",
    key_signal: "flow accumulation",
    entry_range: "180-182",
    target: "190",
    stop: "176",
    options_play: "NVDA 185C",
    ...overrides,
  };
}

function stagePoint(overrides: Partial<CandidateLeaderboardStagePoint>): CandidateLeaderboardStagePoint {
  return {
    stage: "discovery",
    rank: null,
    score: null,
    observed_at: "2026-10-14T02:00:00.000Z",
    selected_for_publish: null,
    rejection_reason: null,
    ...overrides,
  };
}

function leaderboardEntry(overrides: Partial<CandidateLeaderboardEntry>): CandidateLeaderboardEntry {
  return {
    ticker: "AMD",
    trajectory: [stagePoint({})],
    outcome: "in_progress",
    promotion_status: "WATCH",
    rank_delta: null,
    ...overrides,
  };
}

const REGIME: MarketRegimeTag = {
  schema_version: 1,
  trend: "up",
  spx_close: 5800,
  spx_sma20: 5750,
  volatility: "normal",
  vix_close: 18,
  gap_pattern: null,
  gap_pct: null,
  event_day: false,
};

test("buildCommandCenterTable: ACTIVE rows come from plays, mapped to the operator's spec'd columns", () => {
  const table = buildCommandCenterTable({
    plays: [
      play({
        ticker: "NVDA",
        direction: "bullish",
        score: 82,
        entry_range: "180-182",
        target: "190",
        stop: "176",
        key_signal: "flow accumulation",
        risk_note: "invalidated below 174",
      }),
    ],
    leaderboard: [],
    marketRegime: REGIME,
    confidence: [],
  });

  assert.deepEqual(table.active, [
    {
      ticker: "NVDA",
      direction: "bullish",
      score: 82,
      entry: "180-182",
      stop: "176",
      targets: "190",
      why_now: "flow accumulation",
      invalidation: "invalidated below 174",
    },
  ]);
});

test("buildCommandCenterTable: a play with no risk_note reads invalidation null, never fabricated", () => {
  const table = buildCommandCenterTable({
    plays: [play({ ticker: "AMD", risk_note: undefined })],
    leaderboard: [],
    marketRegime: null,
    confidence: [],
  });
  assert.equal(table.active[0]!.invalidation, null);
});

test("buildCommandCenterTable: leaderboard WATCH/READY/TRIGGERED entries land in watching, not rejected or active", () => {
  const table = buildCommandCenterTable({
    plays: [],
    leaderboard: [
      leaderboardEntry({ ticker: "WATCH1", promotion_status: "WATCH", rank_delta: null }),
      leaderboardEntry({ ticker: "READY1", promotion_status: "READY", rank_delta: 3 }),
      leaderboardEntry({ ticker: "TRIG1", promotion_status: "TRIGGERED", rank_delta: -1 }),
    ],
    marketRegime: null,
    confidence: [],
  });
  assert.equal(table.active.length, 0);
  assert.equal(table.rejected.length, 0);
  assert.deepEqual(
    table.watching.map((r) => r.ticker),
    ["WATCH1", "READY1", "TRIG1"]
  );
  assert.deepEqual(
    table.watching.map((r) => r.promotion_status),
    ["WATCH", "READY", "TRIGGERED"]
  );
  assert.deepEqual(table.watching.map((r) => r.rank_delta), [null, 3, -1]);
});

test("buildCommandCenterTable: REJECTED entries carry their rejection_reason off the rejected trajectory point", () => {
  const table = buildCommandCenterTable({
    plays: [],
    leaderboard: [
      leaderboardEntry({
        ticker: "TSLA",
        promotion_status: "REJECTED",
        outcome: "rejected",
        trajectory: [
          stagePoint({ stage: "discovery" }),
          stagePoint({ stage: "scored", rank: 5, score: 60 }),
          stagePoint({ stage: "rejected", rejection_reason: "confluence_gate_failed" }),
        ],
      }),
    ],
    marketRegime: null,
    confidence: [],
  });
  assert.equal(table.watching.length, 0);
  assert.deepEqual(table.rejected, [{ ticker: "TSLA", rejection_reason: "confluence_gate_failed" }]);
});

test("buildCommandCenterTable: ACTIVE-status leaderboard entries are excluded from watching/rejected (already in `active` from plays)", () => {
  const table = buildCommandCenterTable({
    plays: [play({ ticker: "NVDA" })],
    leaderboard: [leaderboardEntry({ ticker: "NVDA", promotion_status: "ACTIVE", outcome: "published" })],
    marketRegime: null,
    confidence: [],
  });
  assert.equal(table.active.length, 1);
  assert.equal(table.watching.length, 0);
  assert.equal(table.rejected.length, 0);
});

test("buildCommandCenterTable: market_regime and system_confidence pass through verbatim, no recomputation", () => {
  const confidence = [
    { conviction: "high", n: 12, win_rate_pct: 58.3, win_rate_ci_low_pct: 32.1, win_rate_ci_high_pct: 80.7 },
  ];
  const table = buildCommandCenterTable({
    plays: [],
    leaderboard: [],
    marketRegime: REGIME,
    confidence,
  });
  assert.deepEqual(table.market_regime, REGIME);
  assert.deepEqual(table.system_confidence, confidence);
});

test("buildCommandCenterTable: null market_regime stays null, never guessed (e.g. pre-edition-build)", () => {
  const table = buildCommandCenterTable({ plays: [], leaderboard: [], marketRegime: null, confidence: [] });
  assert.equal(table.market_regime, null);
});

test("buildCommandCenterTable: empty inputs produce empty sections, not a crash", () => {
  const table = buildCommandCenterTable({ plays: [], leaderboard: [], marketRegime: null, confidence: [] });
  assert.deepEqual(table.active, []);
  assert.deepEqual(table.watching, []);
  assert.deepEqual(table.rejected, []);
  assert.deepEqual(table.system_confidence, []);
});
