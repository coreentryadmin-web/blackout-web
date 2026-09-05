import { test } from "node:test";
import assert from "node:assert/strict";
import {
  commitPillarsFromFeatureVector,
  deriveManageEdgeReads,
  liveManageEdgePillars,
} from "./manage-edge-reads.ts";

const ASC = Array.from({ length: 60 }, (_, i) => 100 + i);
const DESC = Array.from({ length: 60 }, (_, i) => 160 - i);
const FLAT_SPY = Array.from({ length: 60 }, () => 400);
const RISK_ON_SPY = Array.from({ length: 60 }, (_, i) => 380 + i * 0.5);

test("commitPillarsFromFeatureVector: rehydrates pillar sub-scores from pinned vector", () => {
  const pillars = commitPillarsFromFeatureVector({
    pil_flow: 0.8,
    pil_rel_strength: 0.7,
    pil_catalyst: 0.6,
    pil_regime: 0.55,
  });
  assert.equal(pillars?.flow, 0.8);
  assert.equal(pillars?.relStrength, 0.7);
});

test("liveManageEdgePillars: uptrend name vs flat SPY → strong rel strength for LONG", () => {
  const live = liveManageEdgePillars({ nameCloses: ASC, spyCloses: FLAT_SPY, direction: "long" });
  assert.ok((live.relStrength ?? 0) > 0.5);
});

test("deriveManageEdgeReads: flow_decay when strong commit flow stalls", () => {
  const reads = deriveManageEdgeReads({
    archetype: "FLOW_ACCUMULATION",
    direction: "long",
    sessionsHeld: 4,
    thesisProgress01: 0.1,
    commit: { flow: 0.75 },
  });
  assert.equal(reads.flowDecayed, true);
});

test("deriveManageEdgeReads: rel_strength_loss when live RS collapses", () => {
  const reads = deriveManageEdgeReads({
    archetype: "BREAKOUT",
    direction: "long",
    sessionsHeld: 2,
    thesisProgress01: 0.5,
    commit: { relStrength: 0.8 },
    live: { relStrength: 0.2 },
  });
  assert.equal(reads.relStrengthLost, true);
});

test("deriveManageEdgeReads: regime_shift when tape flips against LONG", () => {
  const reads = deriveManageEdgeReads({
    archetype: "BREAKOUT",
    direction: "long",
    sessionsHeld: 2,
    thesisProgress01: 0.4,
    commit: { regime: 0.8 },
    live: { regime: 0.2 },
  });
  assert.equal(reads.regimeShift, true);
});

test("deriveManageEdgeReads: POST_EARNINGS_DRIFT thesis_stop after stalled drift", () => {
  const reads = deriveManageEdgeReads({
    archetype: "POST_EARNINGS_DRIFT",
    direction: "long",
    sessionsHeld: 6,
    thesisProgress01: 0.05,
    commit: { catalyst: 0.7 },
  });
  assert.equal(reads.thesisBroken, true);
  assert.match(reads.thesisBreakReason ?? "", /drift failed/i);
});

test("deriveManageEdgeReads: EVENT_DRIVEN catalyst_shift when catalyst does not follow through", () => {
  const reads = deriveManageEdgeReads({
    archetype: "EVENT_DRIVEN",
    direction: "long",
    sessionsHeld: 3,
    thesisProgress01: 0.05,
    commit: { catalyst: 0.8 },
  });
  assert.equal(reads.catalystShift, true);
});

test("deriveManageEdgeReads: honest nulls when inputs are too thin", () => {
  const reads = deriveManageEdgeReads({ archetype: "BREAKOUT", direction: "long" });
  assert.equal(reads.flowDecayed, undefined);
  assert.equal(reads.thesisBroken, undefined);
});
