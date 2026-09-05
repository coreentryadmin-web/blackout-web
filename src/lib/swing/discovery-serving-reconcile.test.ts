import { test } from "node:test";
import assert from "node:assert/strict";
import { reconcileServingAfterCommits } from "./discovery.ts";
import type { SwingWatchCandidate } from "./accumulation-store.ts";
import type { HorizonPlay, HorizonPlaySet } from "../horizon-plays.ts";
import type { SwingCommitPlan, SwingCommitResult } from "./commit.ts";
import type { SwingDossier } from "./dossier.ts";
import type { ChainContract } from "../horizon-fanout.ts";

const contract: ChainContract = {
  ticker: "NVDA",
  strike: 150,
  expiry: "2026-09-19",
  side: "call",
  dte: 10,
  mid: 5,
  delta: 0.45,
  gamma: 0.02,
  theta: -0.1,
  vega: 0.2,
  iv: 0.35,
  openInterest: 5000,
  volume: 1200,
  spreadPct: 0.02,
};

function watch(ticker: string): SwingWatchCandidate {
  return {
    ticker,
    direction: "LONG",
    archetype: "BREAKOUT",
    observationCount: 3,
    distinctSessionDays: 2,
    phasesSeen: ["POST_CLOSE"],
    signalKinds: ["FLOW"],
    sessionSignalKinds: ["FLOW"],
    lastSessionDay: "2026-09-04",
    firstSeenAt: "2026-09-03T16:00:00.000Z",
    lastSeenAt: "2026-09-04T16:00:00.000Z",
  };
}

function play(ticker: string): HorizonPlay {
  return {
    ticker,
    direction: "LONG",
    horizon: "SWING",
    score: 80,
    status: "WATCH",
    contract,
    scoreFloor: 60,
    reason: "test",
    archetype: "BREAKOUT",
  };
}

test("reconcileServingAfterCommits: drops committed thesis from WATCH and stamps play COMMIT", () => {
  const watchCandidates = [watch("NVDA"), watch("AMD")];
  const playSet: HorizonPlaySet = {
    ZERO_DTE: [],
    SWING: [play("NVDA"), play("AMD")],
    LEAPS: [],
  };
  const plan: SwingCommitPlan = {
    decisions: [
      {
        ticker: "NVDA",
        direction: "LONG",
        archetype: "BREAKOUT",
        subLane: "Standard",
        commitKey: "2026-09-04:NVDA:Standard:long",
        graduated: true,
        committable: true,
        riskUsd: 500,
        blockedBy: [],
        reason: "open",
      },
      {
        ticker: "AMD",
        direction: "LONG",
        archetype: "BREAKOUT",
        subLane: "Standard",
        commitKey: "2026-09-04:AMD:Standard:long",
        graduated: true,
        committable: false,
        riskUsd: 500,
        blockedBy: ["budget:theme"],
        reason: "blocked",
      },
    ],
    commitEligibleCount: 2,
    committableCount: 1,
    shadowEligibleCount: 0,
    budget: { totalUsd: 50_000, themePct: 0.25, sectorPct: 0.35, namePct: 0.1 },
  };
  const commitResult: SwingCommitResult = {
    committed: [
      {
        ticker: "NVDA",
        direction: "LONG",
        commitKey: "2026-09-04:NVDA:Standard:long",
        positionId: 42,
      },
    ],
    skipped: [],
    shadowed: [],
    errors: 0,
  };
  const dossierByKey = new Map<string, SwingDossier>();

  const out = reconcileServingAfterCommits(watchCandidates, playSet, plan, commitResult, dossierByKey);

  assert.deepEqual(out.watchCandidates.map((c) => c.ticker), ["AMD"]);
  assert.equal(out.playSet.SWING.find((p) => p.ticker === "NVDA")?.status, "COMMIT");
  assert.equal(out.playSet.SWING.find((p) => p.ticker === "AMD")?.status, "WATCH");
});

test("reconcileServingAfterCommits: no-op when commit insert failed (positionId null)", () => {
  const watchCandidates = [watch("NVDA")];
  const playSet: HorizonPlaySet = { ZERO_DTE: [], SWING: [play("NVDA")], LEAPS: [] };
  const plan: SwingCommitPlan = {
    decisions: [
      {
        ticker: "NVDA",
        direction: "LONG",
        archetype: "BREAKOUT",
        subLane: "Standard",
        commitKey: "2026-09-04:NVDA:Standard:long",
        graduated: true,
        committable: true,
        riskUsd: 500,
        blockedBy: [],
        reason: "open",
      },
    ],
    commitEligibleCount: 1,
    committableCount: 1,
    shadowEligibleCount: 0,
    budget: { totalUsd: 50_000, themePct: 0.25, sectorPct: 0.35, namePct: 0.1 },
  };
  const commitResult: SwingCommitResult = {
    committed: [
      {
        ticker: "NVDA",
        direction: "LONG",
        commitKey: "2026-09-04:NVDA:Standard:long",
        positionId: null,
        error: "insert failed",
      },
    ],
    skipped: [],
    shadowed: [],
    errors: 1,
  };

  const out = reconcileServingAfterCommits(watchCandidates, playSet, plan, commitResult, new Map());

  assert.equal(out.watchCandidates.length, 1);
  assert.equal(out.playSet.SWING[0]!.status, "WATCH");
});
