import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateSwingGates, type SwingGateContext } from "./gates.ts";
import type { SwingDossier } from "./dossier.ts";
import { SWING_SUB_LANES, SWING_ARCHETYPES, type SwingArchetype, type SwingSubLane } from "./taxonomy.ts";
import type { ChainContract, PlayDirection } from "../horizon-fanout.ts";

function fits(win: SwingArchetype): Record<SwingArchetype, number | null> {
  const f = {} as Record<SwingArchetype, number | null>;
  for (const a of SWING_ARCHETYPES) f[a] = a === win ? 0.8 : null;
  return f;
}

function makeDossier(o: Partial<{
  direction: PlayDirection | null;
  subLane: SwingSubLane | null;
  score: number;
  archetype: SwingArchetype | null;
  degraded: boolean;
}> = {}): SwingDossier {
  const direction = o.direction ?? "LONG";
  const subLane = o.subLane === undefined ? "STANDARD" : o.subLane;
  const archetype = o.archetype === undefined ? "BREAKOUT" : o.archetype;
  const score = o.score ?? 70;
  return {
    v: 1,
    ticker: "NVDA",
    direction,
    asOf: "2026-07-24T14:00:00.000Z",
    archetype: { archetype, confidence: 0.8, margin: 0.3, fits: archetype ? fits(archetype) : fits("BREAKOUT"), reason: "" },
    pillarSignals: {},
    score: { score, archetype, subLane, contributions: [], presentCount: 6, reason: "" },
    subLane,
    dataQuality: { degraded: o.degraded ?? false, presentPillars: o.degraded ? 2 : 6, missing: o.degraded ? ["STRUCTURE"] : [] },
  };
}

const liquidContract: ChainContract = {
  ticker: "NVDA", right: "C", expiry: "2026-08-14", dte: 21, strike: 100,
  delta: 0.6, openInterest: 1000, bid: 1.0, ask: 1.05, mid: 1.025,
};

// TRIGGERED + AT_TRIGGER, structurally clean context.
function baseCtx(o: Partial<SwingGateContext> = {}): SwingGateContext {
  return {
    asOf: "2026-07-24T14:00:00.000Z",
    liquidity: SWING_SUB_LANES.STANDARD.liquidity,
    setupReads: { price: 100.5, triggerPx: 100, invalidationPx: 95, atr: 5 },
    entryReads: { price: 100.5, triggerPx: 100, entryZoneFar: 96, atr: 5 },
    atr: 5,
    ...o,
  };
}

test("happy path: structurally clean + TRIGGERED + score≥floor → COMMIT", () => {
  const r = evaluateSwingGates(makeDossier(), liquidContract, baseCtx());
  assert.equal(r.verdict, "COMMIT");
  assert.equal(r.setupState, "TRIGGERED");
  assert.equal(r.calibration.clearsFloor, true);
  assert.equal(r.calibration.scoreFloorGraduated, false);
  assert.equal(r.blocks.filter((b) => b.enforced).length, 0);
});

test("STRUCTURAL: illiquid contract vetoes → SKIP", () => {
  const r = evaluateSwingGates(makeDossier(), { ...liquidContract, openInterest: 100 }, baseCtx());
  assert.equal(r.verdict, "SKIP");
  const b = r.blocks.find((x) => x.code === "liquidity");
  assert.ok(b && b.enforced && b.severity === "SKIP");
});

test("STRUCTURAL: wide spread vetoes → SKIP", () => {
  const wide: ChainContract = { ...liquidContract, bid: 1.0, ask: 1.5, mid: 1.25 };
  const r = evaluateSwingGates(makeDossier(), wide, baseCtx());
  assert.equal(r.verdict, "SKIP");
  assert.ok(r.blocks.some((x) => x.code === "spread" && x.enforced));
});

test("STRUCTURAL: invalidated thesis vetoes → SKIP", () => {
  const r = evaluateSwingGates(makeDossier(), liquidContract, baseCtx({ setupReads: { price: 94, triggerPx: 100, invalidationPx: 95, atr: 5 } }));
  assert.equal(r.verdict, "SKIP");
  assert.equal(r.setupState, "INVALIDATED");
  assert.ok(r.blocks.some((x) => x.code === "thesis_invalidated" && x.enforced));
});

test("STRUCTURAL: no sub-lane → expiry_insufficient → SKIP", () => {
  const r = evaluateSwingGates(makeDossier({ subLane: null }), liquidContract, baseCtx());
  assert.equal(r.verdict, "SKIP");
  assert.ok(r.blocks.some((x) => x.code === "expiry_insufficient" && x.enforced));
});

test("STRUCTURAL: earnings-in-window without auth vetoes → SKIP; with auth clears", () => {
  const blocked = evaluateSwingGates(makeDossier(), liquidContract, baseCtx({ earningsInWindow: true }));
  assert.equal(blocked.verdict, "SKIP");
  assert.ok(blocked.blocks.some((x) => x.code === "event_in_window" && x.enforced));
  const authed = evaluateSwingGates(makeDossier(), liquidContract, baseCtx({ earningsInWindow: true, eventAuthorized: true }));
  assert.equal(authed.verdict, "COMMIT");
});

test("STRUCTURAL: stale quote → WATCH (transient, not SKIP)", () => {
  const r = evaluateSwingGates(makeDossier(), liquidContract, baseCtx({ quoteAgeMs: 10 * 60 * 1000 }));
  assert.equal(r.verdict, "WATCH");
  const b = r.blocks.find((x) => x.code === "quote_stale");
  assert.ok(b && b.enforced && b.severity === "WATCH");
});

test("STRUCTURAL: incomplete daily bar → WATCH", () => {
  const r = evaluateSwingGates(makeDossier(), liquidContract, baseCtx({ dailyBarComplete: false }));
  assert.equal(r.verdict, "WATCH");
  assert.ok(r.blocks.some((x) => x.code === "daily_bar_incomplete" && x.severity === "WATCH"));
});

test("FAIL-CLOSED: missing context or contract → SKIP", () => {
  assert.equal(evaluateSwingGates(makeDossier(), null, baseCtx()).verdict, "SKIP");
  assert.equal(evaluateSwingGates(makeDossier(), liquidContract, null).verdict, "SKIP");
  const r = evaluateSwingGates(makeDossier(), liquidContract, null);
  assert.ok(r.blocks.some((x) => x.code === "gate_context_unavailable" && x.enforced));
});

test("EDGE: reward_risk_floor logs wouldBlock but does NOT change the COMMIT verdict", () => {
  const r = evaluateSwingGates(makeDossier(), liquidContract, baseCtx({ rewardRiskRatio: 1.2 }));
  assert.equal(r.verdict, "COMMIT"); // verdict unchanged vs happy path
  const b = r.blocks.find((x) => x.code === "reward_risk_floor");
  assert.ok(b, "reward_risk_floor block present");
  assert.equal(b!.kind, "edge");
  assert.equal(b!.enforced, false);
  assert.equal(b!.wouldBlock, true);
  assert.equal(b!.severity, null);
});

test("EDGE: entry_extended logs wouldBlock but does NOT change the verdict", () => {
  // price 103 = 3 past trigger: <1·ATR (still TRIGGERED) but >0.5·ATR (entry chase).
  const ctx = baseCtx({
    setupReads: { price: 103, triggerPx: 100, invalidationPx: 95, atr: 5 },
    entryReads: { price: 103, triggerPx: 100, entryZoneFar: 96, atr: 5 },
  });
  const r = evaluateSwingGates(makeDossier(), liquidContract, ctx);
  assert.equal(r.setupState, "TRIGGERED");
  assert.equal(r.verdict, "COMMIT");
  const b = r.blocks.find((x) => x.code === "entry_extended");
  assert.ok(b && b.kind === "edge" && b.enforced === false && b.wouldBlock === true);
});

test("ROUTING: below the provisional floor → WATCH (not COMMIT), floor stays ungraduated", () => {
  const r = evaluateSwingGates(makeDossier({ score: 40 }), liquidContract, baseCtx());
  assert.equal(r.verdict, "WATCH");
  assert.equal(r.calibration.clearsFloor, false);
  assert.equal(r.calibration.scoreFloorGraduated, false);
});

test("ROUTING: FORMING setup (not yet triggered) → WATCH even when clean and high-score", () => {
  const r = evaluateSwingGates(makeDossier({ score: 90 }), liquidContract, baseCtx({
    setupReads: { price: 97, triggerPx: 100, invalidationPx: 95, atr: 5 },
    entryReads: { price: 97, triggerPx: 100, entryZoneFar: 96, atr: 5 },
  }));
  assert.equal(r.setupState, "FORMING");
  assert.equal(r.verdict, "WATCH");
});

test("SOFT: degraded read is an evidence-only penalty, not a block (still COMMIT)", () => {
  const r = evaluateSwingGates(makeDossier({ degraded: true }), liquidContract, baseCtx());
  assert.equal(r.verdict, "COMMIT");
  assert.ok(r.softPenalties.some((p) => p.code === "degraded_read"));
  assert.equal(r.blocks.filter((b) => b.enforced).length, 0);
});

test("SOFT: portfolio overlap surfaces as an evidence-only penalty", () => {
  const r = evaluateSwingGates(makeDossier(), liquidContract, baseCtx({
    existingPositions: [{ ticker: "AMD", direction: "LONG" }],
  }));
  assert.ok(r.softPenalties.some((p) => p.code === "portfolio_overlap"));
  assert.equal(r.verdict, "COMMIT"); // evidence-only, does not block
});

test("entryPlan invariants surface through the gate (actualFill null, deadline != expiry)", () => {
  const r = evaluateSwingGates(makeDossier(), liquidContract, baseCtx());
  assert.equal(r.entryPlan.actualFill, null);
  assert.notEqual(r.entryPlan.entryDeadline, liquidContract.expiry);
});
