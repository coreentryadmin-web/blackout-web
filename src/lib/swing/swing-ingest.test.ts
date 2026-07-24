import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assembleSwingDossierInput,
  ingestSwingReads,
  pctReturnOverSessions,
  emaStackFromCloses,
  accumulationReadFromSignal,
  type SwingIngestDeps,
} from "./swing-ingest.ts";
import type { FlowAccumulationSignal } from "../../features/nighthawk/lib/flow-accumulation.ts";
import type { BreakoutMover } from "../../features/nighthawk/lib/candidates.ts";

const ASC = Array.from({ length: 60 }, (_, i) => 100 + i); // steady uptrend, last close 159
const DESC = Array.from({ length: 60 }, (_, i) => 160 - i); // steady downtrend, last close 101
const FLAT_SPY = Array.from({ length: 60 }, () => 400);

function bullSignal(): FlowAccumulationSignal {
  return {
    ticker: "NVDA",
    direction: "bull",
    strength: 82,
    netSignedPremium: 6_000_000,
    magnet: {
      ticker: "NVDA",
      strike: 150,
      expiry: "2026-08-21",
      side: "call",
      days: 4,
      hits: 12,
      weightedPremium: 5_000_000,
      signedPremium: 5_000_000,
      sweepRatio: 0.6,
      openingRatio: 0.8,
      score: 90,
    },
    top: [],
  };
}

test("pctReturnOverSessions: correct return, null when too short / bad reference", () => {
  assert.equal(pctReturnOverSessions([100, 110], 1), 10);
  assert.equal(pctReturnOverSessions([100], 1), null); // too short
  assert.equal(pctReturnOverSessions([0, 110], 1), null); // non-positive reference
  const r = pctReturnOverSessions(ASC, 10);
  assert.ok(r != null && r > 0, "an uptrend has a positive 10-session return");
});

test("emaStackFromCloses: full stack on enough bars, absent (empty) when too few", () => {
  const up = emaStackFromCloses(ASC);
  assert.equal(up.priceAboveEma20, true);
  assert.equal(up.ema20AboveEma50, true);
  assert.equal(up.ema50Rising, true);

  const down = emaStackFromCloses(DESC);
  assert.equal(down.priceAboveEma20, false);
  assert.equal(down.ema20AboveEma50, false);
  assert.equal(down.ema50Rising, false);

  // Too few bars → every flag ABSENT (undefined), never a fabricated stance.
  const thin = emaStackFromCloses([100, 101, 102]);
  assert.equal(thin.priceAboveEma20, undefined);
  assert.equal(thin.ema20AboveEma50, undefined);
  assert.equal(thin.ema50Rising, undefined);
});

test("accumulationReadFromSignal projects the signal onto the SwingReads accumulation shape", () => {
  const read = accumulationReadFromSignal(bullSignal());
  assert.equal(read.direction, "bull");
  assert.equal(read.days, 4); // from the magnet
  assert.equal(read.magnet_strike, 150);
  assert.equal(read.magnet_side, "call");
  assert.equal(read.aligned, null); // swing direction IS the accumulation direction; aligned is a 0DTE concept
});

test("assembleSwingDossierInput: bull flow + uptrend → directional dossier input with signed pillars", () => {
  const input = assembleSwingDossierInput({
    ticker: "nvda",
    asOf: "2026-07-24T21:00:00.000Z",
    intendedDte: 14,
    accumulation: bullSignal(),
    flowWindowDays: 5,
    nameCloses: ASC,
    spyCloses: FLAT_SPY,
    mover: null,
  });
  assert.equal(input.ticker, "NVDA");
  assert.equal(input.intendedDte, 14);
  assert.ok(input.reads.accumulation != null);
  assert.equal(input.reads.accumulation!.direction, "bull");
  // Signed rel-strength: name uptrend vs flat SPY → positive name return passed through.
  assert.ok((input.relStrength!.nameReturnPct ?? 0) > 0);
  // Structure stack aligned bullish for a LONG.
  assert.equal(input.structure!.priceAboveEma20, true);
  assert.equal(input.flow!.accumTotalDays, 5);
  assert.ok((input.flow!.aggression01 ?? 0) > 0);
});

test("FM#1: flow-less (structure-only) candidate STILL assembles a dossier input (null accumulation)", () => {
  const mover: BreakoutMover = { ticker: "ASTS", gain: 0.12, volume: 8_000_000, close_strength: 0.9, dollar: 8e8 };
  const input = assembleSwingDossierInput({
    ticker: "ASTS",
    asOf: "2026-07-24T21:00:00.000Z",
    intendedDte: 14,
    accumulation: null, // NO flow — pure structure path
    flowWindowDays: 5,
    nameCloses: ASC,
    spyCloses: FLAT_SPY,
    mover,
  });
  assert.equal(input.reads.accumulation, null, "flow-less path carries a null accumulation read, not a fabricated one");
  // Structure evidence from the breakout screen still grounds the archetype extras.
  assert.ok((input.archetypeExtras!.breakoutQuality01 ?? 0) > 0);
  assert.ok((input.archetypeExtras!.volumeExpansion01 ?? 0) > 0);
  // The EMA stack still grounds the STRUCTURE pillar even with no flow.
  assert.equal(input.structure!.priceAboveEma20, true);
});

test("assembleSwingDossierInput is deterministic on fixed inputs", () => {
  const args = {
    ticker: "NVDA",
    asOf: "2026-07-24T21:00:00.000Z",
    intendedDte: 14,
    accumulation: bullSignal(),
    flowWindowDays: 5,
    nameCloses: ASC,
    spyCloses: FLAT_SPY,
    mover: null,
  } as const;
  assert.deepEqual(assembleSwingDossierInput({ ...args }), assembleSwingDossierInput({ ...args }));
});

test("ingestSwingReads: fetches name closes then assembles; null when no history", async () => {
  const deps: SwingIngestDeps = {
    async fetchDailyCloses(ticker) {
      return ticker.toUpperCase() === "NVDA" ? ASC : [];
    },
  };
  const ok = await ingestSwingReads(deps, {
    ticker: "NVDA",
    asOf: "2026-07-24T21:00:00.000Z",
    intendedDte: 14,
    accumulation: bullSignal(),
    flowWindowDays: 5,
    spyCloses: FLAT_SPY,
  });
  assert.ok(ok != null);
  assert.equal(ok!.ticker, "NVDA");

  const none = await ingestSwingReads(deps, {
    ticker: "ZZZZ",
    asOf: "2026-07-24T21:00:00.000Z",
    accumulation: null,
    flowWindowDays: 5,
    spyCloses: FLAT_SPY,
  });
  assert.equal(none, null, "a name with no daily history is dropped, not carried as a hollow dossier");
});
