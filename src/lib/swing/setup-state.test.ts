import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveSetupState, type SetupStateReads } from "./setup-state.ts";
import type { SwingDossier } from "./dossier.ts";
import { SWING_ARCHETYPES, type SwingArchetype } from "./taxonomy.ts";
import type { PlayDirection } from "../horizon-fanout.ts";

function fits(win: SwingArchetype): Record<SwingArchetype, number | null> {
  const f = {} as Record<SwingArchetype, number | null>;
  for (const a of SWING_ARCHETYPES) f[a] = a === win ? 0.8 : null;
  return f;
}

function dossier(direction: PlayDirection | null): SwingDossier {
  return {
    v: 1,
    ticker: "NVDA",
    direction,
    asOf: "2026-07-24T14:00:00.000Z",
    archetype: { archetype: "BREAKOUT", confidence: 0.8, margin: 0.3, fits: fits("BREAKOUT"), reason: "" },
    pillarSignals: {},
    score: { score: 70, archetype: "BREAKOUT", subLane: "STANDARD", contributions: [], presentCount: 6, reason: "" },
    subLane: "STANDARD",
    dataQuality: { degraded: false, presentPillars: 6, missing: [] },
  };
}

test("LONG: below trigger → FORMING", () => {
  const reads: SetupStateReads = { price: 98, triggerPx: 100, invalidationPx: 95 };
  assert.equal(deriveSetupState(dossier("LONG"), reads), "FORMING");
});

test("LONG: at/just past trigger, no ATR overshoot → TRIGGERED", () => {
  const reads: SetupStateReads = { price: 100.5, triggerPx: 100, invalidationPx: 95, atr: 5 };
  assert.equal(deriveSetupState(dossier("LONG"), reads), "TRIGGERED");
});

test("LONG: >1·ATR past trigger → EXTENDED", () => {
  const reads: SetupStateReads = { price: 106, triggerPx: 100, invalidationPx: 95, atr: 5 };
  assert.equal(deriveSetupState(dossier("LONG"), reads), "EXTENDED");
});

test("LONG: price through invalidation → INVALIDATED (dominates everything)", () => {
  const reads: SetupStateReads = { price: 94, triggerPx: 100, invalidationPx: 95, atr: 5 };
  assert.equal(deriveSetupState(dossier("LONG"), reads), "INVALIDATED");
});

test("SHORT mirrors: below trigger triggers, above invalidation invalidates", () => {
  const dir = dossier("SHORT");
  assert.equal(deriveSetupState(dir, { price: 99.5, triggerPx: 100, invalidationPx: 105, atr: 5 }), "TRIGGERED");
  assert.equal(deriveSetupState(dir, { price: 102, triggerPx: 100, invalidationPx: 105, atr: 5 }), "FORMING");
  assert.equal(deriveSetupState(dir, { price: 93, triggerPx: 100, invalidationPx: 105, atr: 5 }), "EXTENDED");
  assert.equal(deriveSetupState(dir, { price: 106, triggerPx: 100, invalidationPx: 105, atr: 5 }), "INVALIDATED");
});

test("no direction or no trigger → FORMING (honest 'not actionable'), unless invalidation broke", () => {
  assert.equal(deriveSetupState(dossier(null), { price: 100, triggerPx: 100, invalidationPx: 95 }), "FORMING");
  assert.equal(deriveSetupState(dossier("LONG"), { price: 100, triggerPx: null, invalidationPx: 95 }), "FORMING");
  // invalidation is checked independently of the trigger
  assert.equal(deriveSetupState(dossier("LONG"), { price: 90, triggerPx: null, invalidationPx: 95 }), "INVALIDATED");
});
