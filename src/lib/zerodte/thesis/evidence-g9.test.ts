import { test } from "node:test";
import assert from "node:assert/strict";
import { thesisEvidenceToLegacyExtras } from "./evidence-bundle-map";
import { buildMergedThesisFromHits } from "./pipeline";
import { stampPinSetupPositioning } from "./pin-positioning-stamp";
import { resolveThesisRankTier } from "./live-pipeline";
import type { RailHit } from "./types";

test("evidence map: thermal + vector → legacy extras", () => {
  const extras = thesisEvidenceToLegacyExtras({
    thermal: {
      gamma_posture: "long",
      call_wall: 510,
      put_wall: 495,
      gex_king_strike: 505,
      cross_validation_divergence: 0.02,
    },
    vector: {
      resistance: 512,
      support: 494,
      bead_wall_near_spot: 511,
      expected_move_pct: 2.4,
      dark_pool_bias: "bullish",
    },
  });
  assert.equal(extras.gamma_posture, "long");
  assert.equal(extras.call_wall, 510);
  assert.equal(extras.resistance, 512);
  assert.equal(extras.bead_wall_near_spot, 511);
  assert.equal(extras.expected_move_pct, 2.4);
  assert.equal(extras.dark_pool_bias, "bullish");
});

test("merge G9: disagreeing rails preserved on MergedThesis", () => {
  const hits: RailHit[] = [
    { rail: "FLOW", ticker: "TSLA", direction: "long", score: 70, summary: "flow long" },
    { rail: "MOMENTUM", ticker: "TSLA", direction: "short", score: 65, summary: "mom short" },
    { rail: "BREAKOUT", ticker: "TSLA", direction: "long", score: 80, summary: "break long" },
  ];
  const thesis = buildMergedThesisFromHits("TSLA", hits)!;
  assert.equal(thesis.direction, "long");
  assert.equal(thesis.disagreeing_rails.length, 1);
  assert.equal(thesis.disagreeing_rails[0]!.rail, "MOMENTUM");
  assert.equal(thesis.disagreeing_rails[0]!.direction, "short");
  assert.equal(thesis.rail_scores.MOMENTUM, undefined);
});

test("rank tier: direction conflict caps at WATCH", () => {
  const tier = resolveThesisRankTier(
    {
      ticker: "TSLA",
      direction: "long",
      rail_scores: { BREAKOUT: 82, FLOW: 70 },
      rails_fired: ["BREAKOUT", "FLOW"],
      systems_aligned: 2,
      trade_archetype: "BREAKOUT",
      archetype_score: 80,
      structural_state: "TRIGGERED",
      trigger_price: 250,
      summaries: {},
      disagreeing_rails: [{ rail: "MOMENTUM", direction: "short", score: 65, summary: "opp" }],
    },
    { verdict: "PASS", archetype: "BREAKOUT", blocks: [], notes: [] }
  );
  assert.equal(tier, "WATCH");
});

test("pin positioning stamp: wires gamma + walls onto setup", () => {
  const setup = stampPinSetupPositioning(
    {
      ticker: "SPY",
      direction: "short",
      discovery_origin: ["PIN"],
      score: 72,
      gamma_regime: null,
      key_resistances: [],
      key_supports: [],
      gex_king_strike: null,
    } as never,
    { gamma_posture: "long", call_wall: 580, put_wall: 570, gex_king_strike: 575 }
  );
  assert.equal(setup.gamma_regime, "long_gamma");
  assert.deepEqual(setup.key_resistances, [580]);
  assert.deepEqual(setup.key_supports, [570]);
  assert.equal(setup.gex_king_strike, 575);
});
