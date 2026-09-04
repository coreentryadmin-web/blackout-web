import { test } from "node:test";
import assert from "node:assert/strict";
import type { CortexVerdict } from "@/lib/nighthawk/cortex";
import { applyCortexCommitRelief, vectorExemptsCortexBlocks } from "./cortex-vector-relief";
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
