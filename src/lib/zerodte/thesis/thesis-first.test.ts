import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyTradeArchetype, ARCHETYPE_LABEL } from "./archetype";
import { evaluateArchetypeGates } from "./archetype-gates";
import { pickBestExpression, rankContractsForThesis } from "./contract-engine";
import { countSystemsAligned } from "./merge";
import { buildMergedThesisFromHits, mergeScanPassTheses, runThesisPipelineForSetup } from "./pipeline";
import { scoreBreakoutRail } from "./rails/breakout";
import { scoreFlowRail } from "./rails/flow";
import { scoreRsRail } from "./rails/rs";
import { scoreCatalystRail } from "./rails/catalyst";
import { scoreVolRail } from "./rails/vol";
import { thesisFirstCommitBlocks } from "./live-pipeline";
import { resolveThesisRankTier } from "./live-pipeline";
import { strikesAroundSpot } from "./contract-attach";
import type { RailHit } from "./types";

test("merge: NVDA multi-rail panel matches operator spec shape", () => {
  const hits: RailHit[] = [
    { rail: "FLOW", ticker: "NVDA", direction: "long", score: 88, summary: "campaign", flow_class: "CAMPAIGN" },
    { rail: "MOMENTUM", ticker: "NVDA", direction: "long", score: 91, summary: "RVOL 2.8×" },
    { rail: "BREAKOUT", ticker: "NVDA", direction: "long", score: 84, summary: "COILED", structural_state: "COILED", meta: { trigger_price: 181.5 } },
    { rail: "RS", ticker: "NVDA", direction: "long", score: 93, summary: "α +1.2%" },
    { rail: "POSITIONING", ticker: "NVDA", direction: "long", score: 76, summary: "VACUUM" },
  ];
  const thesis = buildMergedThesisFromHits("NVDA", hits)!;
  assert.equal(thesis.systems_aligned, countSystemsAligned(thesis.rail_scores));
  assert.ok(thesis.systems_aligned >= 4);
  assert.equal(thesis.rail_scores.FLOW, 88);
  assert.equal(thesis.rail_scores.RS, 93);
  assert.equal(thesis.structural_state, "COILED");
  assert.equal(thesis.trigger_price, 181.5);
  const arch = classifyTradeArchetype(thesis.rail_scores, thesis.structural_state);
  assert.ok(ARCHETYPE_LABEL[arch.archetype]);
});

test("archetype gates: COILED breakout → WATCH not PASS", () => {
  const gates = evaluateArchetypeGates({
    archetype: "BREAKOUT",
    rail_scores: { BREAKOUT: 84, MOMENTUM: 91 },
    structural_state: "COILED",
  });
  assert.equal(gates.verdict, "WATCH");
  assert.ok(gates.notes.some((n) => n.includes("coiled")));
});

test("archetype gates: mean reversion notes g1 relax candidate", () => {
  const gates = evaluateArchetypeGates({
    archetype: "MEAN_REVERSION",
    rail_scores: { REVERSAL: 72, POSITIONING: 65 },
    structural_state: null,
  });
  assert.equal(gates.verdict, "PASS");
  assert.ok(gates.notes.includes("g1_relax_candidate"));
});

test("contract engine: picks 4DTE over rich 0DTE", () => {
  const thesis = buildMergedThesisFromHits("NVDA", [
    { rail: "RS", ticker: "NVDA", direction: "long", score: 93, summary: "" },
    { rail: "MOMENTUM", ticker: "NVDA", direction: "long", score: 91, summary: "" },
  ])!;
  const chain = [
    { expiry: "2026-08-25", strike: 182.5, dte: 0, side: "call" as const, bid: 4.0, ask: 4.8, oi: 500 },
    { expiry: "2026-08-26", strike: 182.5, dte: 1, side: "call" as const, bid: 4.5, ask: 4.7, oi: 800 },
    { expiry: "2026-08-29", strike: 185, dte: 4, side: "call" as const, bid: 3.2, ask: 3.35, oi: 1200 },
  ];
  const ranked = rankContractsForThesis({ thesis, chain, spot: 181.32, iv_rank_0dte: 88 });
  assert.ok(ranked.length >= 2);
  const expr = pickBestExpression({ thesis, chain, spot: 181.32, iv_rank_0dte: 88 });
  assert.equal(expr.horizon, "ZERO_DTE");
  assert.equal(expr.dte_target, 4);
  assert.ok(expr.vol_rationale?.includes("IV rank"));
});

test("breakout rail: COILED at resistance", () => {
  const hit = scoreBreakoutRail({
    ticker: "NVDA",
    direction: "long",
    spot: 181.32,
    resistance: 181.5,
    rel_vol: 2.8,
  });
  assert.ok(hit);
  assert.equal(hit!.structural_state, "COILED");
  assert.equal(hit!.meta?.trigger_price, 181.5);
});

test("RS rail: session alpha vs sector", () => {
  const hit = scoreRsRail({
    ticker: "NVDA",
    direction: "long",
    stock_session_pct: 1.8,
    qqq_session_pct: 0.3,
    sector_session_pct: 0.6,
  });
  assert.ok(hit);
  assert.ok(hit!.score >= 55);
  assert.ok(hit!.summary.includes("α"));
});

test("flow rail: CAMPAIGN classification from persistence", () => {
  const hit = scoreFlowRail({
    ticker: "NVDA",
    direction: "long",
    gross_premium: 12_800_000,
    flow_quality: {
      score: 82,
      components: { premiumDepth: 18, aggression: 14, sweepIntensity: 12, persistence: 14, concentration: 10, momentum: 10, institutional: 4 },
      momentum: { spanMin: 42, premiumPerMin: 300, sweepsPerMin: 0.5, netPremiumSlopePerMin: 50, rollingAggression: 0.74, rollingDominance: 0.8, accelerating: true },
      dominantSide: "call",
      dominance: 0.74,
      reason: "test",
    },
  });
  assert.ok(hit);
  assert.equal(hit!.flow_class, "CAMPAIGN");
});

test("pipeline: legacy setup bridge produces thesis snapshot", () => {
  const setup = {
    ticker: "NVDA",
    direction: "long" as const,
    discovery_origin: ["BREAKOUT" as const, "FLOW" as const],
    gross_premium: 5_000_000,
    score: 78,
    underlying_price: 181.32,
    key_resistances: [181.5],
    key_supports: [178],
    rel_volume: 2.8,
    rsi14: 58,
    gamma_regime: "short_gamma",
    intraday: null,
    flow_quality: null,
  };
  const result = runThesisPipelineForSetup(setup as never, {
    stock_session_pct: 1.8,
    qqq_session_pct: 0.3,
    sector_session_pct: 0.6,
  });
  assert.ok(result.thesis.rails_fired.length >= 2);
  assert.ok(["A", "A+", "B", "WATCH"].includes(result.rank_tier));
});

test("pipeline: a real cross-origin conflict surfaces in disagreeing_rails, not silently agrees", () => {
  // The bug this pins (2026-08-26): every rail hit used to echo `setup.direction`
  // unconditionally, so disagreeing_rails could never fire even when the board's own merge
  // recorded a genuine cross-origin conflict (origin_contributions). Here FLOW argued long
  // (the direction the board kept) while PIN independently argued short — origin_contributions
  // carries both real votes, same as a live merged setup.
  const setup = {
    ticker: "NVDA",
    direction: "long" as const,
    discovery_origin: ["FLOW" as const, "PIN" as const],
    gross_premium: 3_000_000,
    score: 80,
    underlying_price: 100,
    key_resistances: [110],
    key_supports: [95],
    gex_king_strike: 110,
    gamma_regime: "long_gamma",
    rel_volume: 1.2,
    intraday: null,
    flow_quality: null,
    origin_contributions: {
      FLOW: { direction: "long" as const, score: 80 },
      PIN: { direction: "short" as const, score: 70 },
    },
  };
  const result = runThesisPipelineForSetup(setup as never, {});
  assert.equal(result.thesis.direction, "long", "thesis must still describe the board's kept/traded direction");
  assert.ok(
    result.thesis.disagreeing_rails.some((r) => r.rail === "POSITIONING" && r.direction === "short"),
    "PIN's real opposing vote must surface as a disagreeing rail"
  );
  // The disagreeing rail must NOT contribute to the aligned rail_scores/archetype conviction.
  assert.equal(result.thesis.rail_scores.POSITIONING, undefined);
});

test("catalyst rail: flags + hot headline", () => {
  const hit = scoreCatalystRail({
    ticker: "NVDA",
    direction: "long",
    catalyst_flags: ["FDA", "guidance"],
    news_hot: { title: "Beat", minutes_ago: 15, published: null, url: null },
    earnings: null,
  });
  assert.ok(hit);
  assert.equal(hit!.rail, "CATALYST");
  assert.ok(hit!.score >= 55);
});

test("vol rail: elevated RVOL + short gamma", () => {
  const hit = scoreVolRail({
    ticker: "TSLA",
    direction: "long",
    rel_volume: 2.4,
    gamma_regime: "short_gamma",
    rsi14: 62,
  });
  assert.ok(hit);
  assert.equal(hit!.rail, "VOL");
});

test("rank tier: solo BREAKOUT without FLOW/MOMENTUM caps at WATCH not A", () => {
  const tier = resolveThesisRankTier(
    {
      ticker: "MRNA",
      direction: "long",
      rail_scores: { BREAKOUT: 82 },
      rails_fired: ["BREAKOUT"],
      systems_aligned: 1,
      trade_archetype: "BREAKOUT",
      archetype_score: 78,
      structural_state: "TRIGGERED",
      trigger_price: 90,
      summaries: { BREAKOUT: "coiled" },
      disagreeing_rails: [],
    },
    { verdict: "PASS", archetype: "BREAKOUT", blocks: [], notes: [] }
  );
  assert.equal(tier, "WATCH");
});

test("rank tier: solo BREAKOUT with MOMENTUM corroboration may rank A", () => {
  const tier = resolveThesisRankTier(
    {
      ticker: "HOOD",
      direction: "long",
      rail_scores: { BREAKOUT: 82, MOMENTUM: 70 },
      rails_fired: ["BREAKOUT", "MOMENTUM"],
      systems_aligned: 2,
      trade_archetype: "BREAKOUT",
      archetype_score: 80,
      structural_state: "TRIGGERED",
      trigger_price: 100,
      summaries: {},
      disagreeing_rails: [],
    },
    { verdict: "PASS", archetype: "BREAKOUT", blocks: [], notes: [] }
  );
  assert.equal(tier, "A");
});

test("live pipeline: thesis blocks on archetype BLOCK", () => {
  const result: import("./types").ThesisPipelineResult = {
    thesis: {
      ticker: "X",
      direction: "long",
      rail_scores: { MOMENTUM: 50, RS: 40 },
      rails_fired: ["MOMENTUM", "RS"],
      systems_aligned: 0,
      trade_archetype: "MOMENTUM_CONTINUATION",
      archetype_score: 55,
      structural_state: null,
      trigger_price: null,
      summaries: {},
      disagreeing_rails: [],
    },
    archetype_gates: { verdict: "BLOCK", archetype: "MOMENTUM_CONTINUATION", blocks: ["momentum_rs_floor"], notes: [] },
    expression: null,
    rank_tier: "REJECT",
  };
  const blocks = thesisFirstCommitBlocks(result);
  assert.ok(blocks.includes("thesis_momentum_rs_floor"));
  assert.ok(blocks.includes("thesis_rank_reject"));
});

test("strikesAroundSpot: ATM ladder", () => {
  const strikes = strikesAroundSpot(181.32, 5);
  assert.ok(strikes.length >= 3);
  assert.ok(strikes.some((s) => Math.abs(s - 181.5) < 1 || Math.abs(s - 181) < 1));
});

test("mergeScanPassTheses: unions tickers across setups", () => {
  const a = {
    ticker: "NVDA",
    direction: "long" as const,
    discovery_origin: ["FLOW" as const],
    gross_premium: 3_000_000,
    score: 80,
    underlying_price: 100,
    intraday: null,
    flow_quality: null,
  };
  const b = {
    ticker: "NVDA",
    direction: "long" as const,
    discovery_origin: ["BREAKOUT" as const],
    gross_premium: 0,
    score: 75,
    underlying_price: 100,
    key_resistances: [101],
    rel_volume: 2,
    intraday: null,
    flow_quality: null,
  };
  const map = mergeScanPassTheses([a as never, b as never]);
  assert.ok(map.has("NVDA"));
  assert.ok((map.get("NVDA")!.rail_scores.FLOW ?? 0) > 0);
  assert.ok((map.get("NVDA")!.rail_scores.BREAKOUT ?? 0) > 0);
});
