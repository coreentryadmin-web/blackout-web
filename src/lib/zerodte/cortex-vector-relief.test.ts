import { test } from "node:test";
import assert from "node:assert/strict";
import type { CortexVerdict } from "@/lib/nighthawk/cortex";
import { applyCortexCommitRelief, gexWallsVetoWasRelieved, vectorExemptsCortexBlocks } from "./cortex-vector-relief";
import { cortexGateBlocks } from "./cortex-gate";
import type { ZeroDteVectorPulse } from "./vector-crosslink-core";

const AS_OF = "2026-09-04T16:00:00.000Z";

function pulse(winner = true): ZeroDteVectorPulse {
  return {
    premium_pct: 80,
    peak_premium_pct: 120,
    action_status: "still_buy",
    is_winner: winner,
    is_runner: false,
    side: "call",
    direction: "long",
    strike: 100,
    occ: "O:X",
    rank: 1,
    role: "flow",
  };
}

function verdict(over: Partial<CortexVerdict> = {}): CortexVerdict {
  return {
    ticker: "SNDK",
    direction: "long",
    asOf: AS_OF,
    vetoes: [],
    score: 0.4,
    supports: [],
    opposes: [],
    absent: [],
    narrative: [],
    conviction: "B",
    contested: false,
    ...over,
  };
}

const amplifyCtx = {
  direction: "long" as const,
  score: 88,
  discovery_origin: ["FLOW"] as const,
  gamma_regime: "short_gamma",
  market_aligned: true,
  regime_structure: "TREND_UP",
  market_state_confidence: 0.85,
  vector_pulse: null,
};

test("vectorExemptsCortexBlocks: aligned Vector winner", () => {
  const prev = process.env.ZERODTE_VECTOR_CORTEX_RELIEF;
  delete process.env.ZERODTE_VECTOR_CORTEX_RELIEF;
  assert.equal(vectorExemptsCortexBlocks("long", 70, pulse()), true);
  assert.equal(vectorExemptsCortexBlocks("long", 70, null), false);
  if (prev !== undefined) process.env.ZERODTE_VECTOR_CORTEX_RELIEF = prev;
});

test("applyCortexCommitRelief: strips gex-walls VETO when Vector winner aligned", () => {
  const prev = process.env.ZERODTE_VECTOR_CORTEX_RELIEF;
  delete process.env.ZERODTE_VECTOR_CORTEX_RELIEF;
  const blocked = {
    decision: "VETO" as const,
    abstained: false as const,
    verdict: verdict({
      vetoes: [{ source: "gex-walls", detail: "wall in path", weight: 1, stance: "vetoes", halfLifeSec: 900, asOf: AS_OF }],
      score: 0.2,
    }),
  };
  const relieved = applyCortexCommitRelief(blocked, "long", 72, pulse(), amplifyCtx);
  assert.equal(relieved.decision, "PASS");
  assert.deepEqual(cortexGateBlocks(relieved), []);
  if (prev !== undefined) process.env.ZERODTE_VECTOR_CORTEX_RELIEF = prev;
});

test("applyCortexCommitRelief: NET_NEGATIVE → PASS for Vector winner", () => {
  const prev = process.env.ZERODTE_VECTOR_CORTEX_RELIEF;
  delete process.env.ZERODTE_VECTOR_CORTEX_RELIEF;
  const blocked = {
    decision: "NET_NEGATIVE" as const,
    abstained: false as const,
    verdict: verdict({ score: -0.3, opposes: [{ source: "sector-heat", detail: "weak", weight: 0.3, stance: "opposes", halfLifeSec: 900, asOf: AS_OF }] }),
  };
  const relieved = applyCortexCommitRelief(blocked, "long", 72, pulse(), amplifyCtx);
  assert.equal(relieved.decision, "PASS");
  if (prev !== undefined) process.env.ZERODTE_VECTOR_CORTEX_RELIEF = prev;
});

test("applyCortexCommitRelief: flow-quality VETO is never stripped", () => {
  const prev = process.env.ZERODTE_VECTOR_CORTEX_RELIEF;
  delete process.env.ZERODTE_VECTOR_CORTEX_RELIEF;
  const blocked = {
    decision: "VETO" as const,
    abstained: false as const,
    verdict: verdict({
      vetoes: [{ source: "flow-quality", detail: "opposing whales", weight: 1, stance: "vetoes", halfLifeSec: 900, asOf: AS_OF }],
    }),
  };
  const relieved = applyCortexCommitRelief(blocked, "long", 72, pulse(), amplifyCtx);
  assert.equal(relieved.decision, "VETO");
  if (prev !== undefined) process.env.ZERODTE_VECTOR_CORTEX_RELIEF = prev;
});

test("applyCortexCommitRelief: BREAKOUT 85+ amplify strips gex-walls without Vector pulse", () => {
  const prev = process.env.ZERODTE_AMPLIFY_CORTEX_RELIEF;
  delete process.env.ZERODTE_AMPLIFY_CORTEX_RELIEF;
  const breakoutCtx = {
    ...amplifyCtx,
    discovery_origin: ["BREAKOUT"] as const,
    vector_pulse: null,
  };
  const blocked = {
    decision: "VETO" as const,
    abstained: false as const,
    verdict: verdict({
      vetoes: [{ source: "gex-walls", detail: "wall in path", weight: 1, stance: "vetoes", halfLifeSec: 900, asOf: AS_OF }],
      score: 0.2,
    }),
  };
  const relieved = applyCortexCommitRelief(blocked, "long", 88, null, breakoutCtx);
  assert.equal(relieved.decision, "PASS");
  if (prev !== undefined) process.env.ZERODTE_AMPLIFY_CORTEX_RELIEF = prev;
});

// Live-monitor finding, 2026-09-09 (SHOP/MSTR): a play committed via relief carries a
// frozen `cortex` blob whose narrative still says "BLOCKED by 1 veto" / lists the
// "VETO [gex-walls] ..." line (narrative is composed BEFORE relief strips the vetoes
// array — compose.ts never regenerates it), while `decision` is PASS and `vetoes` is
// empty. gexWallsVetoWasRelieved() must detect exactly this post-relief shape so the
// exit engine can be told not to immediately re-veto on the fact relief overrode.
test("gexWallsVetoWasRelieved: detects the post-relief narrative/vetoes mismatch", () => {
  const prev = process.env.ZERODTE_VECTOR_CORTEX_RELIEF;
  delete process.env.ZERODTE_VECTOR_CORTEX_RELIEF;
  const blocked = {
    decision: "VETO" as const,
    abstained: false as const,
    verdict: verdict({
      vetoes: [{ source: "gex-walls", detail: "short target path crosses dominant wall", weight: 1, stance: "vetoes", halfLifeSec: 900, asOf: AS_OF }],
      score: 0.03,
      narrative: [
        "CORTEX SHOP short: BLOCKED by 1 veto (net score +0.03), conviction C.",
        "VETO [gex-walls] short target path crosses dominant wall",
      ],
    }),
  };
  assert.equal(gexWallsVetoWasRelieved(blocked), false, "not relieved yet — still carries the veto");
  const relieved = applyCortexCommitRelief(blocked, "long", 72, pulse(), amplifyCtx);
  assert.equal(relieved.decision, "PASS", "sanity: relief actually stripped the veto for this fixture");
  assert.equal(gexWallsVetoWasRelieved(relieved), true, "narrative still says BLOCKED but vetoes[] is now empty");
  if (prev !== undefined) process.env.ZERODTE_VECTOR_CORTEX_RELIEF = prev;
});

test("gexWallsVetoWasRelieved: false when the veto never fired (no narrative line to strand)", () => {
  const clean = {
    decision: "PASS" as const,
    abstained: false as const,
    verdict: verdict({ narrative: ["CORTEX SHOP short: net score +0.40, conviction B."] }),
  };
  assert.equal(gexWallsVetoWasRelieved(clean), false);
});

test("gexWallsVetoWasRelieved: false when the veto is still active (not relieved)", () => {
  const stillVetoed = {
    decision: "VETO" as const,
    abstained: false as const,
    verdict: verdict({
      vetoes: [{ source: "gex-walls", detail: "wall in path", weight: 1, stance: "vetoes", halfLifeSec: 900, asOf: AS_OF }],
      narrative: ["CORTEX SHOP short: BLOCKED by 1 veto (net score +0.03), conviction C.", "VETO [gex-walls] wall in path"],
    }),
  };
  assert.equal(gexWallsVetoWasRelieved(stillVetoed), false);
});

test("gexWallsVetoWasRelieved: false for an abstained assessment", () => {
  assert.equal(gexWallsVetoWasRelieved({ decision: "VETO_BLIND", abstained: true, reason: "no data" }), false);
});
