import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildDeskEvidenceLines,
  countDeskAlignment,
} from "./desk-evidence-lines";
import type { MergedThesis } from "./types";

const baseThesis = (): MergedThesis => ({
  ticker: "NVDA",
  direction: "long",
  rail_scores: {
    FLOW: 78,
    BREAKOUT: 72,
    POSITIONING: 70,
    CATALYST: 58,
  },
  rails_fired: ["FLOW", "BREAKOUT", "POSITIONING", "CATALYST"],
  systems_aligned: 4,
  trade_archetype: "BREAKOUT",
  archetype_score: 82,
  structural_state: "TRIGGERED",
  trigger_price: 875,
  summaries: {
    FLOW: "quality sweep · CAMPAIGN",
    BREAKOUT: "TRIGGERED · RVOL 2.4×",
    POSITIONING: "VACUUM · γ long",
    CATALYST: "earnings AMC",
  },
  disagreeing_rails: [],
});

test("buildDeskEvidenceLines: HELIX + THERMAL use extras when present", () => {
  const lines = buildDeskEvidenceLines({
    thesis: baseThesis(),
    rank_tier: "A",
    extras: {
      helix_gross_premium: 2_100_000,
      helix_print_count: 6,
      helix_direction_bias: "long",
      gamma_posture: "long",
      call_wall: 875,
      dark_pool_bias: "bullish",
      expected_move_pct: 2.4,
      bead_wall_near_spot: 872,
    },
  });

  const helix = lines.find((l) => l.desk === "HELIX")!;
  assert.match(helix.text, /\$2\.1M/);
  assert.equal(helix.status, "aligned");

  const thermal = lines.find((l) => l.desk === "THERMAL")!;
  assert.match(thermal.text, /long-gamma/);
  assert.match(thermal.text, /875/);
  assert.equal(thermal.status, "aligned");

  const vector = lines.find((l) => l.desk === "VECTOR")!;
  assert.match(vector.text, /TRIGGERED/);
  assert.match(vector.text, /EM ±2\.4%/);

  const nh = lines.find((l) => l.desk === "NIGHTHAWK")!;
  assert.match(nh.text, /^A ·/);
  assert.match(nh.text, /FLOW\+BREAKOUT/);

  const meridian = lines.find((l) => l.desk === "MERIDIAN")!;
  assert.equal(meridian.text, "earnings AMC");
});

test("buildDeskEvidenceLines: BREAKOUT-led HELIX uses structure summary when flow quiet", () => {
  const thesis: MergedThesis = {
    ...baseThesis(),
    rail_scores: { BREAKOUT: 74, MOMENTUM: 68 },
    rails_fired: ["BREAKOUT", "MOMENTUM"],
    summaries: {
      BREAKOUT: "TRIGGERED · RVOL 2.1×",
    },
    disagreeing_rails: [],
  };
  const helix = buildDeskEvidenceLines({ thesis, rank_tier: "WATCH" }).find((l) => l.desk === "HELIX")!;
  assert.match(helix.text, /structure-led/);
  assert.match(helix.text, /TRIGGERED/);
  assert.notEqual(helix.status, "unavailable");
});

test("buildDeskEvidenceLines: MERIDIAN unavailable without catalyst rail", () => {
  const thesis = baseThesis();
  delete thesis.rail_scores.CATALYST;
  delete thesis.summaries.CATALYST;
  thesis.rails_fired = thesis.rails_fired.filter((r) => r !== "CATALYST");

  const meridian = buildDeskEvidenceLines({ thesis, rank_tier: "B" }).find(
    (l) => l.desk === "MERIDIAN"
  )!;
  assert.equal(meridian.status, "unavailable");
  assert.match(meridian.text, /no catalyst/);
});

test("countDeskAlignment excludes unavailable desks", () => {
  const lines = buildDeskEvidenceLines({
    thesis: baseThesis(),
    rank_tier: "A",
    extras: { helix_gross_premium: 1_500_000, helix_direction_bias: "long" },
  });
  const { aligned, available } = countDeskAlignment(lines);
  assert.ok(aligned >= 3);
  assert.ok(available >= 4);
});
