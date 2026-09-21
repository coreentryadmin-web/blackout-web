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

test("buildRankFinalSnapshotRows: schema v3 -- snapshot_json carries the play's own parsed trade-geometry levels (candidate-r-multiple.ts's input)", async () => {
  const { buildRankFinalSnapshotRows } = await import("./edition-builder");
  const rows = buildRankFinalSnapshotRows(
    "2026-09-17",
    [play({ ticker: "NVDA", entry_range: "$100-$104", target: "$112.50", stop: "$96" })],
    new Map()
  );
  const payload = rows[0]!.snapshot_json as any;
  assert.equal(payload.schema_version, 3);
  assert.equal(payload.levels.entry_range_low, 100);
  assert.equal(payload.levels.entry_range_high, 104);
  assert.equal(payload.levels.target, 112.5);
  assert.equal(payload.levels.stop, 96);
});

test("buildRankFinalSnapshotRows: v3 additive fields -- setup_type derives from the play's own factor_breakdown, dte from the play's own dte", async () => {
  const { buildRankFinalSnapshotRows } = await import("./edition-builder");
  const rows = buildRankFinalSnapshotRows(
    "2026-09-17",
    [play({ ticker: "NVDA", factor_breakdown: { flow: 20, tech: 5, positioning: 2, smart_money: 1, news: 0 }, dte: 5 })],
    new Map()
  );
  const payload = rows[0]!.snapshot_json as any;
  assert.equal(payload.setup_type, "flow_led");
  assert.equal(payload.dte, 5);
});

test("buildRankFinalSnapshotRows: v3 additive fields are honestly absent/unknown, never fabricated, when the play carries neither", async () => {
  const { buildRankFinalSnapshotRows } = await import("./edition-builder");
  const rows = buildRankFinalSnapshotRows("2026-09-17", [play({ ticker: "NVDA" })], new Map());
  const payload = rows[0]!.snapshot_json as any;
  assert.equal(payload.setup_type, "unknown");
  assert.equal(payload.dte, null);
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

// ── buildStageRejectionSnapshotRows (closes the gap: 6 of 7 STAGE-6 rejection reasons never
// reached nighthawk_candidate_snapshot despite the table's own header doc claiming they did) ──

test("buildStageRejectionSnapshotRows: a premium_cap rejection gets a 'rejected' row carrying its own rejection_reason and the real gate detail", async () => {
  const { buildStageRejectionSnapshotRows } = await import("./edition-builder");
  const rows = buildStageRejectionSnapshotRows("2026-09-17", [
    {
      ticker: "NVDA",
      detail: { stage: "premium_cap", entry_premium: 900, cap_per_share: 5, entry_cost_per_contract: 900, cap_per_contract: 500 },
      scored: scored({ ticker: "NVDA", score: 55 }),
    },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.stage, "rejected");
  assert.equal(rows[0]!.rejection_reason, "premium_cap");
  assert.equal(rows[0]!.selected_for_publish, false);
  assert.equal(rows[0]!.score, 55);
  assert.equal(rows[0]!.rank, null);
  const payload = rows[0]!.snapshot_json as any;
  assert.equal(payload.detail.stage, "premium_cap");
  assert.equal(payload.detail.entry_premium, 900);
});

test("buildStageRejectionSnapshotRows: every one of the 6 non-governor NighthawkRejectionDetail stages produces a distinctly-tagged row", async () => {
  const { buildStageRejectionSnapshotRows } = await import("./edition-builder");
  const rows = buildStageRejectionSnapshotRows("2026-09-17", [
    { ticker: "A", detail: { stage: "geometry", drops: ["target<=entry"] }, scored: null },
    { ticker: "B", detail: { stage: "premium_cap", entry_premium: 900, cap_per_share: 5, entry_cost_per_contract: 900, cap_per_contract: 500 }, scored: null },
    { ticker: "C", detail: { stage: "illiquid_strike", strike: 100, side: "call", expiry: "2026-10-16", open_interest: 5, min_open_interest: 500 }, scored: null },
    { ticker: "D", detail: { stage: "ungrounded", issues: [{ check: "target", detail: "not on chain" }] }, scored: null },
    { ticker: "E", detail: { stage: "sector_concentration", sector: "Tech", already_filled: 3, max_per_sector: 3 }, scored: null },
    { ticker: "F", detail: { stage: "publish_gate", blocks: [{ code: "band_detached", reason: "r", threshold: 3.5, value: 9.1 }] }, scored: null },
  ]);
  assert.deepEqual(
    rows.map((r) => r.rejection_reason).sort(),
    ["geometry", "illiquid_strike", "premium_cap", "publish_gate", "sector_concentration", "ungrounded"]
  );
  for (const r of rows) assert.equal(r.stage, "rejected");
});

test("buildStageRejectionSnapshotRows: a candidate with no scored breakdown (mechanical-fallback path) captures a null confluence and null score, never fabricated", async () => {
  const { buildStageRejectionSnapshotRows } = await import("./edition-builder");
  const rows = buildStageRejectionSnapshotRows("2026-09-17", [
    { ticker: "NVDA", detail: { stage: "geometry", drops: ["target<=entry"] } },
  ]);
  assert.equal(rows[0]!.score, null);
  assert.equal((rows[0]!.snapshot_json as any).confluence, null);
});

test("buildStageRejectionSnapshotRows: an empty rejection list produces an empty result", async () => {
  const { buildStageRejectionSnapshotRows } = await import("./edition-builder");
  assert.deepEqual(buildStageRejectionSnapshotRows("2026-09-17", []), []);
});

test("buildStageRejectionSnapshotRows: schema v3 -- a rejection WITH a play (premium_cap/illiquid_strike/ungrounded/sector_concentration/publish_gate all carry one) captures its parsed levels + direction", async () => {
  const { buildStageRejectionSnapshotRows } = await import("./edition-builder");
  const rows = buildStageRejectionSnapshotRows("2026-09-17", [
    {
      ticker: "NVDA",
      detail: { stage: "premium_cap", entry_premium: 900, cap_per_share: 5, entry_cost_per_contract: 900, cap_per_contract: 500 },
      scored: scored({ ticker: "NVDA" }),
      play: play({ ticker: "NVDA", direction: "SHORT", entry_range: "$100-$104", target: "$88", stop: "$110" }),
    },
  ]);
  const payload = rows[0]!.snapshot_json as any;
  assert.equal(payload.schema_version, 3);
  assert.equal(payload.direction, "SHORT");
  assert.equal(payload.levels.entry_range_low, 100);
  assert.equal(payload.levels.stop, 110);
});

test("buildStageRejectionSnapshotRows: v3 -- setup_type derives from the passed-in scored candidate, dte from the play (null when the play never had a contract)", async () => {
  const { buildStageRejectionSnapshotRows } = await import("./edition-builder");
  const rows = buildStageRejectionSnapshotRows("2026-09-17", [
    {
      ticker: "NVDA",
      detail: { stage: "sector_concentration", sector: "Tech", already_filled: 3, max_per_sector: 3 },
      scored: scored({ ticker: "NVDA", flow_score: 30, tech_score: 5, pos_score: 2, news_score: 0, smart_money_score: 1 }),
      play: play({ ticker: "NVDA", dte: 3 }),
    },
  ]);
  const payload = rows[0]!.snapshot_json as any;
  assert.equal(payload.setup_type, "flow_led");
  assert.equal(payload.dte, 3);
});

test("buildStageRejectionSnapshotRows: v3 -- setup_type falls back to the play's factor_breakdown when no scored candidate is passed", async () => {
  const { buildStageRejectionSnapshotRows } = await import("./edition-builder");
  const rows = buildStageRejectionSnapshotRows("2026-09-17", [
    {
      ticker: "NVDA",
      detail: { stage: "publish_gate", blocks: [] },
      scored: null,
      play: play({ ticker: "NVDA", factor_breakdown: { flow: 2, tech: 25, positioning: 1, smart_money: 0, news: 0 } }),
    },
  ]);
  const payload = rows[0]!.snapshot_json as any;
  assert.equal(payload.setup_type, "technical_led");
});

test("buildStageRejectionSnapshotRows: v3 -- confluence_gate rejects (no play, no contract ever picked) honestly report setup_type=unknown, dte=null", async () => {
  const { buildStageRejectionSnapshotRows } = await import("./edition-builder");
  const rows = buildStageRejectionSnapshotRows("2026-09-17", [
    { ticker: "NVDA", detail: { stage: "geometry", drops: ["target<=entry"] }, scored: null },
  ]);
  const payload = rows[0]!.snapshot_json as any;
  assert.equal(payload.setup_type, "unknown");
  assert.equal(payload.dte, null);
});

test("buildStageRejectionSnapshotRows: a rejection with NO play (a future stage that never has one) captures levels:null/direction:null, never a fabricated geometry", async () => {
  const { buildStageRejectionSnapshotRows } = await import("./edition-builder");
  const rows = buildStageRejectionSnapshotRows("2026-09-17", [
    { ticker: "NVDA", detail: { stage: "geometry", drops: ["target<=entry"] }, scored: null },
  ]);
  const payload = rows[0]!.snapshot_json as any;
  assert.equal(payload.levels, null);
  assert.equal(payload.direction, null);
});

// ── buildFinalGeometryGateRejections (task #24 -- the "final geometry gate" safety net
// previously had ZERO durable record anywhere, not even the older alert_audit_log) ──

test("buildFinalGeometryGateRejections: reshapes partitionPlaysByGeometry's {play,drops} into the common rejection shape both writers expect", async () => {
  const { buildFinalGeometryGateRejections } = await import("./edition-builder");
  const backfilledPlay = play({ ticker: "AMD", direction: "SHORT" });
  const result = buildFinalGeometryGateRejections([{ play: backfilledPlay, drops: ["stop<=entry"] }]);
  assert.equal(result.length, 1);
  assert.equal(result[0]!.ticker, "AMD", "ticker pulled from play.ticker -- partitionPlaysByGeometry's own output has none at the top level");
  assert.deepEqual(result[0]!.drops, ["stop<=entry"]);
  assert.deepEqual(result[0]!.detail, { stage: "geometry", drops: ["stop<=entry"] });
  assert.equal(result[0]!.scored, null, "no scored breakdown is reachable this far downstream -- honestly null, never guessed");
  assert.equal(result[0]!.play, backfilledPlay);
});

test("buildFinalGeometryGateRejections: its output feeds BOTH writers without further shaping -- audit trail (drops) and candidate_snapshot (detail) both read correctly off the same row", async () => {
  const { buildFinalGeometryGateRejections, buildStageRejectionSnapshotRows } = await import("./edition-builder");
  const result = buildFinalGeometryGateRejections([{ play: play({ ticker: "TSLA" }), drops: ["target<=entry"] }]);
  const snapshotRows = buildStageRejectionSnapshotRows("2026-09-17", result);
  assert.equal(snapshotRows[0]!.rejection_reason, "geometry");
  assert.equal(snapshotRows[0]!.selected_for_publish, false);
  const payload = snapshotRows[0]!.snapshot_json as any;
  assert.deepEqual(payload.detail.drops, ["target<=entry"]);
  assert.equal(payload.levels.entry_range_low, 100, "the play's own parsed levels are captured via the threaded-through play, same as any other rejection stage");
});

test("buildFinalGeometryGateRejections: an empty failing list produces an empty result", async () => {
  const { buildFinalGeometryGateRejections } = await import("./edition-builder");
  assert.deepEqual(buildFinalGeometryGateRejections([]), []);
});
