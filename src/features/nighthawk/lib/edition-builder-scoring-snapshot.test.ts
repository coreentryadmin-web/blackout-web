import { test } from "node:test";
import assert from "node:assert/strict";
import type { ScoredCandidate } from "./scorer";
import type { PlaybookPlay } from "./types";

// edition-builder.ts's import chain reaches `import "server-only"` transitively (via
// dossier.ts -> gex-positioning.ts) -- same stub dossier.test.ts / edition-builder-scoring-
// history.test.ts use for this boundary.
import { mock } from "node:test";
mock.module("server-only", { namedExports: {} });

// Night Hawk Legacy Signal Intelligence, Phase 1.4: proves buildScoringStageSnapshotRows and
// buildRankFinalSnapshotRows (the pure row-builders the 3 STAGE-4/5 capture points call before
// the actual DB write) produce the right stage/rank/gov_penalty shape. Deliberately does NOT
// mock "@/lib/db" or drive this through the full edition-build integration -- not viable in this
// repo's test environment (once ANY mock.module() targets an aliased-elsewhere specifier, tsx
// stops resolving the "@/" alias across the whole loaded graph; edition-builder.ts's own
// dependency graph is large enough that this is a real risk, not a hypothetical one -- see
// FINDINGS.md's thermalCompareForLargo entry). Only the "server-only" bare-specifier stub is
// needed here (same as dossier.test.ts), since neither pure function under test touches the DB.

function scored(overrides: Partial<ScoredCandidate>): ScoredCandidate {
  return {
    ticker: "TEST",
    score: 70,
    direction: "long",
    flow_score: 20,
    tech_score: 15,
    pos_score: 10,
    news_score: 5,
    smart_money_score: 5,
    conviction: "B",
    ...overrides,
  };
}

function play(overrides: Partial<PlaybookPlay>): PlaybookPlay {
  return {
    rank: 1,
    ticker: "TEST",
    direction: "LONG",
    conviction: "B",
    play_type: "stock",
    thesis: "t",
    key_signal: "k",
    entry_range: "$100-$104",
    target: "$112.50",
    stop: "$96",
    options_play: "TEST 110C 08/21",
    score: 70,
    ...overrides,
  };
}

test("buildScoringStageSnapshotRows: rank is 1-based position in the array as passed, never re-sorted", async () => {
  const { buildScoringStageSnapshotRows } = await import("./edition-builder");
  const candidates = [
    scored({ ticker: "NVDA", score: 50 }), // deliberately NOT sorted by score
    scored({ ticker: "AMD", score: 90 }),
  ];
  const rows = buildScoringStageSnapshotRows("2026-09-17", "scored", candidates);
  assert.equal(rows.find((r) => r.ticker === "NVDA")?.rank, 1, "NVDA is first in the input array, so rank 1, despite the lower score");
  assert.equal(rows.find((r) => r.ticker === "AMD")?.rank, 2);
});

test("buildScoringStageSnapshotRows: stamps the given stage name and each candidate's score/gov_penalty", async () => {
  const { buildScoringStageSnapshotRows } = await import("./edition-builder");
  const rows = buildScoringStageSnapshotRows("2026-09-17", "rank_governor", [
    scored({ ticker: "TSLA", score: 80, govPenalty: 20 }),
  ]);
  assert.equal(rows[0]!.stage, "rank_governor");
  assert.equal(rows[0]!.score, 80, "the RAW score, not the effective/penalized one");
  assert.equal(rows[0]!.gov_penalty, 20);
});

test("buildScoringStageSnapshotRows: a candidate with no govPenalty set captures null, not a fabricated 0", async () => {
  const { buildScoringStageSnapshotRows } = await import("./edition-builder");
  const rows = buildScoringStageSnapshotRows("2026-09-17", "scored", [scored({ ticker: "NVDA" })]);
  assert.equal(rows[0]!.gov_penalty, null);
});

test("buildScoringStageSnapshotRows: never assigns selected_for_publish or rejection_reason -- those are STAGE 6/7's job, not 4/5's", async () => {
  const { buildScoringStageSnapshotRows } = await import("./edition-builder");
  const rows = buildScoringStageSnapshotRows("2026-09-17", "scored", [scored({ ticker: "NVDA" })]);
  assert.equal(rows[0]!.selected_for_publish, null);
  assert.equal(rows[0]!.rejection_reason, null);
});

test("buildScoringStageSnapshotRows: snapshot_json preserves the full component breakdown", async () => {
  const { buildScoringStageSnapshotRows } = await import("./edition-builder");
  const rows = buildScoringStageSnapshotRows("2026-09-17", "scored", [
    scored({ ticker: "NVDA", flow_score: 22, tech_score: 14, catalyst_score: 3, govPenalty: 5 }),
  ]);
  const payload = rows[0]!.snapshot_json as any;
  assert.equal(payload.components.flow_score, 22);
  assert.equal(payload.components.tech_score, 14);
  assert.equal(payload.components.catalyst_score, 3);
  assert.equal(payload.gov_penalty, 5, "the payload's own gov_penalty mirrors the column, for a self-contained row");
});

test("buildRankFinalSnapshotRows: the concrete real-world shape of the governor-blind bug -- rank/score come straight off the PR-N26-sorted play, gov_penalty from the lookup", async () => {
  const { buildRankFinalSnapshotRows } = await import("./edition-builder");
  // A real PR-N26 output: TSLA (governor-demoted, penalty 20) re-promoted to rank 1 by the raw-
  // score sort, exactly the bug this whole capture exists to make provable from real data.
  const plays = [play({ ticker: "TSLA", score: 80, rank: 1 }), play({ ticker: "NVDA", score: 70, rank: 2 })];
  const govPenaltyByTicker = new Map([["TSLA", 20], ["NVDA", 0]]);
  const rows = buildRankFinalSnapshotRows("2026-09-17", plays, govPenaltyByTicker);

  assert.equal(rows[0]!.ticker, "TSLA");
  assert.equal(rows[0]!.rank, 1, "the buggy rank the play was actually published at");
  assert.equal(rows[0]!.score, 80);
  assert.equal(rows[0]!.gov_penalty, 20, "TSLA's real governor penalty -- captured even though the published rank ignores it");
  assert.equal(rows[0]!.stage, "rank_final");
  assert.equal(rows[0]!.selected_for_publish, true, "every rank_final row IS a published play, by construction");
});

test("buildRankFinalSnapshotRows: a ticker absent from govPenaltyByTicker (never reached the governor) captures null, not a fabricated 0", async () => {
  const { buildRankFinalSnapshotRows } = await import("./edition-builder");
  const rows = buildRankFinalSnapshotRows("2026-09-17", [play({ ticker: "NVDA" })], new Map());
  assert.equal(rows[0]!.gov_penalty, null);
});

test("buildRankFinalSnapshotRows: an empty play list produces an empty result", async () => {
  const { buildRankFinalSnapshotRows } = await import("./edition-builder");
  assert.deepEqual(buildRankFinalSnapshotRows("2026-09-17", [], new Map()), []);
});

test("buildGovernorCutSnapshotRows: a governor-cut candidate gets a 'rejected' row with the real reasons and its full scored breakdown", async () => {
  const { buildGovernorCutSnapshotRows } = await import("./edition-builder");
  const rows = buildGovernorCutSnapshotRows("2026-09-17", [
    { ticker: "TSLA", scored: scored({ ticker: "TSLA", score: 65, flow_score: 20 }), reasons: ["loss_streak_halt"] },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.stage, "rejected");
  assert.equal(rows[0]!.rejection_reason, "cross_edition_governor: loss_streak_halt");
  assert.equal(rows[0]!.selected_for_publish, false);
  assert.equal(rows[0]!.score, 65);
  assert.equal(rows[0]!.rank, null, "the governor doesn't rank a cut candidate -- it's gone before ranking matters");
  assert.equal((rows[0]!.snapshot_json as any).components.flow_score, 20);
});

test("buildGovernorCutSnapshotRows: multiple reasons are joined into one readable rejection_reason string", async () => {
  const { buildGovernorCutSnapshotRows } = await import("./edition-builder");
  const rows = buildGovernorCutSnapshotRows("2026-09-17", [
    { ticker: "TSLA", scored: scored({ ticker: "TSLA" }), reasons: ["loss_streak_halt", "sector_concentration_cap"] },
  ]);
  assert.equal(rows[0]!.rejection_reason, "cross_edition_governor: loss_streak_halt; sector_concentration_cap");
});

test("buildGovernorCutSnapshotRows: an empty cut list produces an empty result", async () => {
  const { buildGovernorCutSnapshotRows } = await import("./edition-builder");
  assert.deepEqual(buildGovernorCutSnapshotRows("2026-09-17", []), []);
});
