import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSwingDossier, type SwingDossierInput } from "./dossier.ts";
import type { SwingReads } from "../swing-signals.ts";
import type { ZeroDteFlowAccumulation } from "../zerodte/flow-accumulation-context.ts";
import { swingServingMetaFromDossier, thesisBreakFromMeta } from "./serving-ingest.ts";

function accum(direction: "bull" | "bear", days: number): ZeroDteFlowAccumulation {
  return {
    direction, strength: 80, days,
    net_signed_premium: direction === "bull" ? 5e6 : -5e6,
    magnet_strike: 100, magnet_side: direction === "bull" ? "call" : "put", aligned: true,
  };
}

const reads: SwingReads = {
  accumulation: accum("bull", 4), flowWindowDays: 5,
  returnPct10d: 8, spyReturnPct10d: 1,
  priceAboveEma20: true, ema20AboveEma50: true, ema50Rising: true,
};

// A fully-grounded LONG breakout dossier (all seven pillars present).
const fullInput: SwingDossierInput = {
  ticker: "nvda", intendedDte: 14, asOf: "2026-07-24T14:00:00.000Z", reads,
  archetypeExtras: { nearRangeExtreme01: 0.95, breakoutQuality01: 0.9, volumeExpansion01: 0.9 },
  structure: { priceAboveEma20: true, ema20AboveEma50: true, ema50Rising: true },
  relStrength: { nameReturnPct: 8, spyReturnPct: 1 },
  flow: { accumAlignedDays: 4, accumTotalDays: 5 },
  volatility: { contractQuality01: 0.7, thetaBurden01: 0.3 },
  catalyst: { catalystStrength01: 0.5 },
  regime01: 0.6, dataQuality01: 0.9,
};

test("factors come from the dossier's REAL present-pillar contributions, biggest lever first", () => {
  const d = buildSwingDossier(fullInput);
  const meta = swingServingMetaFromDossier(d);

  // Every factor maps to a PRESENT contribution with positive points (absent pillars are dropped, not 0).
  const presentPillars = d.score.contributions.filter((c) => c.present && c.points > 0).length;
  assert.equal(meta.factors.length, presentPillars);
  assert.ok(meta.factors.length > 0);
  // Ticker normalized; sub-lane + archetype carried from the dossier.
  assert.equal(meta.ticker, "NVDA");
  assert.equal(meta.subLane, "STANDARD");
  assert.equal(meta.archetype, d.archetype.archetype);
  // Biggest lever leads (descending points) — no invented labels.
  for (let i = 1; i < meta.factors.length; i++) {
    assert.ok(meta.factors[i - 1]!.points >= meta.factors[i]!.points);
  }
  assert.ok(meta.factors.every((f) => typeof f.label === "string" && f.label.length > 0));
});

test("regime blends the archetype label with the normalized regime pillar", () => {
  const meta = swingServingMetaFromDossier(buildSwingDossier(fullInput));
  assert.ok(meta.regime && meta.regime.includes("regime 0.60"));
});

test("calibrated probability + EV are LITERAL null (nothing has graduated) — desk shows —", () => {
  const meta = swingServingMetaFromDossier(buildSwingDossier(fullInput));
  assert.equal(meta.calibratedProbability, null);
  assert.equal(meta.expectedValue, null);
});

test("thesis level: no setup read → UNKNOWN (never a fabricated 'intact')", () => {
  const meta = swingServingMetaFromDossier(buildSwingDossier(fullInput));
  assert.equal(meta.setupState, null); // no grounded price-vs-level read supplied
  assert.equal(meta.thesisLevel, "unknown");
  assert.equal(thesisBreakFromMeta(meta).level, "unknown");
});

test("thesis level: a live TRIGGERED setup reads INTACT", () => {
  const d = buildSwingDossier(fullInput);
  const meta = swingServingMetaFromDossier(d, {
    setup: { price: 102, triggerPx: 100, invalidationPx: 90, atr: 3 }, // LONG just past trigger (<1·ATR), in window
  });
  assert.equal(meta.setupState, "TRIGGERED");
  assert.equal(meta.thesisLevel, "intact");
  assert.equal(meta.thesisNote, null);
});

test("thesis level: an INVALIDATED setup reads BREAK with a note", () => {
  const d = buildSwingDossier(fullInput);
  const meta = swingServingMetaFromDossier(d, {
    setup: { price: 85, triggerPx: 100, invalidationPx: 90, atr: 3 }, // LONG closed below invalidation
  });
  assert.equal(meta.setupState, "INVALIDATED");
  assert.equal(meta.thesisLevel, "break");
  assert.match(thesisBreakFromMeta(meta).note!, /invalidated/);
});

test("thesis level: a DEGRADED (thin) read warns", () => {
  // Only the critical STRUCTURE pillar + one more → degraded (missing critical or <3 present).
  const thin: SwingDossierInput = {
    ticker: "AAA", intendedDte: 14, asOf: "2026-07-24T14:00:00.000Z", reads,
    relStrength: { nameReturnPct: 8, spyReturnPct: 1 }, // structure ABSENT → critical missing → degraded
  };
  const d = buildSwingDossier(thin);
  assert.equal(d.dataQuality.degraded, true);
  const meta = swingServingMetaFromDossier(d, {
    setup: { price: 105, triggerPx: 100, invalidationPx: 90, atr: 3 },
  });
  assert.equal(meta.thesisLevel, "warn");
  assert.match(meta.thesisNote!, /thin read/);
});

test("entryStatus derives when grounded entry reads + a contract are supplied", () => {
  const d = buildSwingDossier(fullInput);
  const meta = swingServingMetaFromDossier(d, {
    setup: { price: 105, triggerPx: 100, invalidationPx: 90, atr: 3 },
    entry: { price: 100.5, triggerPx: 100, atr: 3, entryZoneFar: 98 }, // LONG at the trigger
    contract: {
      ticker: "NVDA", right: "C", expiry: "2026-08-14", dte: 21, strike: 100,
      delta: 0.6, openInterest: 3000, bid: 1.2, ask: 1.3, mid: 1.25,
    },
  });
  assert.equal(meta.entryStatus, "AT_TRIGGER");
});
