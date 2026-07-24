import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveEntryPlan, type EntryReads } from "./entry-model.ts";
import type { SwingDossier } from "./dossier.ts";
import { SWING_ARCHETYPES, type SwingArchetype, type SwingSubLane } from "./taxonomy.ts";
import type { ChainContract, PlayDirection } from "../horizon-fanout.ts";

function fits(win: SwingArchetype): Record<SwingArchetype, number | null> {
  const f = {} as Record<SwingArchetype, number | null>;
  for (const a of SWING_ARCHETYPES) f[a] = a === win ? 0.8 : null;
  return f;
}

function dossier(direction: PlayDirection | null, subLane: SwingSubLane | null = "STANDARD"): SwingDossier {
  return {
    v: 1,
    ticker: "NVDA",
    direction,
    asOf: "2026-07-24T14:00:00.000Z",
    archetype: { archetype: "BREAKOUT", confidence: 0.8, margin: 0.3, fits: fits("BREAKOUT"), reason: "" },
    pillarSignals: {},
    score: { score: 70, archetype: "BREAKOUT", subLane, contributions: [], presentCount: 6, reason: "" },
    subLane,
    dataQuality: { degraded: false, presentPillars: 6, missing: [] },
  };
}

const contract: ChainContract = {
  ticker: "NVDA",
  right: "C",
  expiry: "2026-08-14",
  dte: 21,
  strike: 100,
  delta: 0.6,
  openInterest: 1000,
  bid: 1.0,
  ask: 1.05,
  mid: 1.025,
};

const asOf = "2026-07-24T14:00:00.000Z";

test("INVARIANT: actualFill stays null (never fabricated from the plan)", () => {
  const reads: EntryReads = { price: 100.2, triggerPx: 100, entryZoneFar: 96, atr: 5 };
  const plan = deriveEntryPlan(dossier("LONG"), contract, reads, asOf);
  assert.equal(plan.actualFill, null);
});

test("INVARIANT: entryDeadline !== contract.expiry, and strictly before it", () => {
  const reads: EntryReads = { price: 100.2, triggerPx: 100, entryZoneFar: 96, atr: 5 };
  const plan = deriveEntryPlan(dossier("LONG"), contract, reads, asOf);
  assert.notEqual(plan.entryDeadline, contract.expiry);
  assert.ok(Date.parse(plan.entryDeadline) < Date.parse(`${contract.expiry}T00:00:00Z`));
});

test("LONG entry states are monotonic in price vs trigger", () => {
  const base = { triggerPx: 100, entryZoneFar: 96, atr: 5 };
  const d = dossier("LONG");
  assert.equal(deriveEntryPlan(d, contract, { ...base, price: 95 }, asOf).entryState, "PRE_TRIGGER");
  assert.equal(deriveEntryPlan(d, contract, { ...base, price: 98 }, asOf).entryState, "PULLBACK_TO_ENTRY");
  assert.equal(deriveEntryPlan(d, contract, { ...base, price: 101 }, asOf).entryState, "AT_TRIGGER"); // <0.5·ATR past
  assert.equal(deriveEntryPlan(d, contract, { ...base, price: 104 }, asOf).entryState, "EXTENDED_CHASE"); // >0.5·ATR past
});

test("SHORT mirrors the entry-state geometry", () => {
  const base = { triggerPx: 100, entryZoneFar: 104, atr: 5 };
  const d = dossier("SHORT");
  assert.equal(deriveEntryPlan(d, contract, { ...base, price: 106 }, asOf).entryState, "PRE_TRIGGER");
  assert.equal(deriveEntryPlan(d, contract, { ...base, price: 102 }, asOf).entryState, "PULLBACK_TO_ENTRY");
  assert.equal(deriveEntryPlan(d, contract, { ...base, price: 99 }, asOf).entryState, "AT_TRIGGER");
  assert.equal(deriveEntryPlan(d, contract, { ...base, price: 96 }, asOf).entryState, "EXTENDED_CHASE");
});

test("entry limit is the pullback edge when pulling back, else the trigger", () => {
  const d = dossier("LONG");
  const pull = deriveEntryPlan(d, contract, { price: 98, triggerPx: 100, entryZoneFar: 96, atr: 5 }, asOf);
  assert.equal(pull.entryState, "PULLBACK_TO_ENTRY");
  assert.equal(pull.entryLimitPx, 96);
  const atTrig = deriveEntryPlan(d, contract, { price: 101, triggerPx: 100, entryZoneFar: 96, atr: 5 }, asOf);
  assert.equal(atTrig.entryLimitPx, 100);
});

test("deadline clamps strictly before a near-dated expiry (still != expiry)", () => {
  const near: ChainContract = { ...contract, expiry: "2026-07-25", dte: 1 };
  const plan = deriveEntryPlan(dossier("LONG"), near, { price: 101, triggerPx: 100, atr: 5 }, asOf);
  assert.notEqual(plan.entryDeadline, near.expiry);
  assert.ok(Date.parse(plan.entryDeadline) < Date.parse(`${near.expiry}T00:00:00Z`));
});

test("no direction → PRE_TRIGGER, null limit, still null fill", () => {
  const plan = deriveEntryPlan(dossier(null), contract, { price: 101, triggerPx: 100, atr: 5 }, asOf);
  assert.equal(plan.entryState, "PRE_TRIGGER");
  assert.equal(plan.entryLimitPx, null);
  assert.equal(plan.actualFill, null);
});
