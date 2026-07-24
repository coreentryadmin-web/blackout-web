import { test } from "node:test";
import assert from "node:assert/strict";
import { getSwingServingLane, type SwingDiscoveryLike } from "./serving-lane.ts";
import { buildSwingDossier, type SwingDossierInput } from "./dossier.ts";
import type { SwingReads } from "../swing-signals.ts";
import type { ZeroDteFlowAccumulation } from "../zerodte/flow-accumulation-context.ts";
import type { SwingServingReads } from "./serving-ingest.ts";
import type { HorizonPlay } from "../horizon-plays.ts";
import type { ChainContract } from "../horizon-fanout.ts";

function accum(direction: "bull" | "bear", days: number): ZeroDteFlowAccumulation {
  return {
    direction, strength: 80, days,
    net_signed_premium: direction === "bull" ? 5e6 : -5e6,
    magnet_strike: 100, magnet_side: direction === "bull" ? "call" : "put", aligned: true,
  };
}
const bull: SwingReads = {
  accumulation: accum("bull", 4), flowWindowDays: 5, returnPct10d: 8, spyReturnPct10d: 1,
  priceAboveEma20: true, ema20AboveEma50: true, ema50Rising: true,
};
function dossier(ticker: string): SwingDossierInput {
  return {
    ticker, intendedDte: 14, asOf: "2026-07-24T14:00:00.000Z", reads: bull,
    structure: { priceAboveEma20: true, ema20AboveEma50: true, ema50Rising: true },
    relStrength: { nameReturnPct: 8, spyReturnPct: 1 },
    flow: { accumAlignedDays: 4, accumTotalDays: 5 },
    volatility: { contractQuality01: 0.7, thetaBurden01: 0.3 },
    regime01: 0.6, dataQuality01: 0.9,
  };
}
const contract: ChainContract = {
  ticker: "AAA", right: "C", expiry: "2026-08-07", dte: 14, strike: 100,
  delta: 0.6, openInterest: 3000, bid: 1.2, ask: 1.3, mid: 1.25,
};
function play(over: Partial<HorizonPlay>): HorizonPlay {
  return { ticker: "AAA", direction: "LONG", horizon: "SWING", score: 80, status: "COMMIT", contract, scoreFloor: 60, reason: "r", ...over };
}

test("no discover injected → empty structured lane (member-safe default)", async () => {
  const lane = await getSwingServingLane();
  assert.equal(lane.committedCount, 0);
  assert.equal(lane.sections.COMMIT_NOW.length, 0);
  assert.equal(lane.scoreFloorGraduated, false);
});

test("discover returns null / empty plays → empty lane, no throw", async () => {
  assert.equal((await getSwingServingLane({ discover: async () => null })).watchCount, 0);
  assert.equal(
    (await getSwingServingLane({ discover: async () => ({ dossiers: [], plays: [] }) })).watchCount,
    0,
  );
});

test("discover throwing degrades to an empty lane — never throws the route", async () => {
  const lane = await getSwingServingLane({
    discover: async () => {
      throw new Error("DB down");
    },
  });
  assert.equal(lane.committedCount, 0);
  for (const s of Object.values(lane.sections)) assert.equal(s.length, 0);
});

test("assembles a real sectioned lane: WATCH + RESEARCH populate; setupState stamped from reads", async () => {
  const discover = async (): Promise<SwingDiscoveryLike> => ({
    dossiers: [buildSwingDossier(dossier("NVDA")), buildSwingDossier(dossier("WAT"))].map((d) => d),
    plays: [
      play({ ticker: "NVDA", status: "COMMIT" }),
      play({ ticker: "WAT", status: "WATCH" }),
      play({ ticker: "RES", status: "WATCH" }), // no dossier match → RESEARCH
    ],
  });
  const readsByTicker = new Map<string, SwingServingReads>([
    // NVDA: LONG at the trigger, inside the window → TRIGGERED + AT_TRIGGER → COMMIT_NOW.
    ["NVDA", { setup: { price: 100.5, triggerPx: 100, invalidationPx: 90, atr: 3 }, entry: { price: 100.5, triggerPx: 100, atr: 3, entryZoneFar: 98 }, contract }],
    // WAT: LONG below the trigger → FORMING → WATCH.
    ["WAT", { setup: { price: 95, triggerPx: 100, invalidationPx: 90, atr: 3 } }],
  ]);

  const lane = await getSwingServingLane({ discover, readsByTicker });

  assert.equal(lane.sections.COMMIT_NOW.map((p) => p.ticker).join(","), "NVDA");
  assert.deepEqual(lane.sections.WATCH.map((p) => p.ticker), ["WAT"]);
  assert.deepEqual(lane.sections.RESEARCH.map((p) => p.ticker), ["RES"]);
  // Live-position sections stay empty (PR-13).
  assert.equal(lane.sections.MANAGING.length + lane.sections.SCALING_OUT.length + lane.sections.EXITING.length, 0);
  // The stamped observable rode onto the play so the section router could place it.
  assert.equal(lane.sections.COMMIT_NOW[0]!.setupState, "TRIGGERED");
  assert.equal(lane.sections.COMMIT_NOW[0]!.entryStatus, "AT_TRIGGER");
  assert.equal(lane.sections.COMMIT_NOW[0]!.serving, "COMMIT_NOW"); // stamped by the section router
});
