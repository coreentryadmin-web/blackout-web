import test from "node:test";
import assert from "node:assert/strict";
import type { TerminalPlay } from "@/features/nighthawk/command-deck/types";
import type { EcosystemContext } from "@/lib/bie/ecosystem-context";
import type { VectorFullState } from "@/lib/bie/vector-full-state";
import type { SwingPlayBriefContext } from "./play-brief-types";
import type { SwingArchetypeTrackRecordSnapshot, SwingTrackRecordEntry } from "./calibration-cache";
import { buildStructureLadder } from "./play-brief-ladder";

function fixturePlay(overrides: Partial<TerminalPlay> = {}): TerminalPlay {
  return {
    id: "SWING:NVDA",
    ticker: "NVDA",
    direction: "LONG",
    contract: "140C · 20DTE",
    score: 75,
    status: "OPEN",
    horizon: "SWING",
    exitModel: "SCALE_OUT",
    recommendation: "HOLD",
    factors: [],
    gates: [],
    ...overrides,
  };
}

function fixtureCtx(overrides: Partial<SwingPlayBriefContext> = {}): SwingPlayBriefContext {
  return {
    play: fixturePlay(),
    asOf: "2026-09-12 10:00 ET",
    sessionDate: "2026-09-12",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    ecosystem: null,
    vector: null,
    ...overrides,
  };
}

/** A fresh (non-stale) Vector snapshot — `dataAgeMs` well under the 120s staleness bound. */
function fixtureVec(overrides: Partial<VectorFullState> & Record<string, unknown> = {}): VectorFullState {
  return {
    spot: 100,
    dataAgeMs: 1_000,
    darkPoolLevels: [],
    ...overrides,
  } as unknown as VectorFullState;
}

function trackRecordEntry(over: Partial<SwingTrackRecordEntry> = {}): SwingTrackRecordEntry {
  return {
    tier: "LIMITED",
    graduated: true,
    wilsonLbPct: 62.5,
    pointDeltaPts: 22.4,
    n: 60,
    wins: 45,
    losses: 15,
    winRatePct: 75,
    ...over,
  };
}
function trackRecordSnapshot(
  archetypes: SwingArchetypeTrackRecordSnapshot["archetypes"] = {},
): SwingArchetypeTrackRecordSnapshot {
  return { asOf: "2026-09-10T15:00:00.000Z", gradedPlays: 70, archetypes, subLanes: {} };
}

// ── Bucket gate ─────────────────────────────────────────────────────────────

test("buildStructureLadder: null on CLOSED bucket regardless of otherwise-complete inputs", () => {
  const play = fixturePlay({ status: "CLOSED", direction: "LONG" });
  const ctx = fixtureCtx({
    play,
    vector: fixtureVec({ spot: 100, gammaFlip: 110, regime: { posture: "long" } }),
  });
  assert.equal(buildStructureLadder(ctx, play, "closed"), null);
});

test("buildStructureLadder: null when there is no live spot to build from", () => {
  const play = fixturePlay();
  const ctx = fixtureCtx({ play, vector: null, ecosystem: null });
  assert.equal(buildStructureLadder(ctx, play, "open"), null);
  assert.equal(buildStructureLadder(ctx, play, "watch"), null);
});

// ── Rung sorting / labeling / role ──────────────────────────────────────────

test("buildStructureLadder: rungs sort high price -> low price and carry the right kind/label/role", () => {
  const play = fixturePlay({ direction: "LONG" });
  const vec = fixtureVec({
    spot: 100,
    gammaFlip: 101,
    gexWalls: { callWalls: [{ strike: 110 }], putWalls: [{ strike: 95 }] },
    ladder: { rows: [{ strike: 108, isKing: true }] },
    maxPain: 99,
    magnet: { strike: 103, distancePct: 3, pull: "up" },
  });
  const ctx = fixtureCtx({ play, vector: vec, ecosystem: null });
  const ladder = buildStructureLadder(ctx, play, "open");
  assert.ok(ladder);
  assert.equal(ladder!.spot, 100);

  const prices = ladder!.rungs.map((r) => r.price);
  assert.deepEqual(prices, [...prices].sort((a, b) => b - a), "rungs must sort high price -> low price");

  const byKind = Object.fromEntries(ladder!.rungs.map((r) => [r.kind, r]));
  assert.equal(byKind.call_wall.label, "call wall");
  assert.equal(byKind.call_wall.role, "resistance", "call wall above spot is a resistance node");
  assert.equal(byKind.put_wall.label, "put wall");
  assert.equal(byKind.put_wall.role, "support", "put wall below spot is a support node");
  assert.equal(byKind.gamma_flip.role, "neutral", "gamma flip is a regime pivot, not a hard wall");
  assert.equal(byKind.max_pain.role, "neutral", "max pain is a pin statistic, not a hard wall");
  assert.equal(byKind.magnet.role, "neutral", "gamma magnet is a pull node, not a hard wall");
  assert.equal(byKind.king.label, "GEX king");

  // Signed % distance from spot, matching collectFocalLevels' own convention.
  assert.ok(Math.abs(byKind.call_wall.distancePct - 10) < 1e-9);
  assert.ok(Math.abs(byKind.put_wall.distancePct - -5) < 1e-9);
});

// ── Real per-level R:R (point 2) ────────────────────────────────────────────

test("buildStructureLadder: R:R is the REAL deriveSwingPlanLevels ratio, not a fixed multiple", () => {
  const play = fixturePlay({ direction: "LONG" });
  // spot=100 -> atr proxy falls back to price*0.015=1.5 (deriveSwingPlanLevels's own documented
  // fallback, structure-levels.ts) -> stopDist=1.5*atr=2.25, stop=97.75.
  const vec = fixtureVec({ spot: 100, gammaFlip: 110 });
  const ctx = fixtureCtx({ play, vector: vec, ecosystem: null });
  const ladder = buildStructureLadder(ctx, play, "open");
  assert.ok(ladder);
  assert.ok(Math.abs(ladder!.atr - 1.5) < 1e-9);
  assert.ok(Math.abs(ladder!.stop - 97.75) < 1e-9);

  const flipRung = ladder!.rungs.find((r) => r.kind === "gamma_flip");
  assert.ok(flipRung?.target, "a favorable-side rung must carry a target");
  // |110-100| / |100-97.75| = 10 / 2.25
  assert.ok(Math.abs(flipRung!.target!.rewardRisk - 10 / 2.25) < 1e-9);
  assert.equal(flipRung!.target!.horizon, "swing", "10pts is beyond 2x the 1.5 ATR proxy (3pts)");
});

test("buildStructureLadder: horizon classifies short_term within ~2x ATR, swing beyond it", () => {
  const play = fixturePlay({ direction: "LONG" });
  // Two favorable-side rungs straddling the 2xATR=3pt boundary at spot=100, atr=1.5.
  const vec = fixtureVec({
    spot: 100,
    gammaFlip: 103, // exactly 2x ATR -> short_term (<=)
    ladder: { rows: [{ strike: 106, isKing: true }] }, // beyond 2x ATR -> swing
  });
  const ctx = fixtureCtx({ play, vector: vec, ecosystem: null });
  const ladder = buildStructureLadder(ctx, play, "open");
  const flip = ladder!.rungs.find((r) => r.kind === "gamma_flip");
  const king = ladder!.rungs.find((r) => r.kind === "king");
  assert.equal(flip!.target!.horizon, "short_term");
  assert.equal(king!.target!.horizon, "swing");
});

test("buildStructureLadder: target is present ONLY on the favorable side of spot (LONG: above; SHORT: below)", () => {
  const longPlay = fixturePlay({ direction: "LONG" });
  const longCtx = fixtureCtx({
    play: longPlay,
    vector: fixtureVec({
      spot: 100,
      gexWalls: { callWalls: [{ strike: 110 }], putWalls: [{ strike: 90 }] },
    }),
    ecosystem: null,
  });
  const longLadder = buildStructureLadder(longCtx, longPlay, "open")!;
  assert.ok(longLadder.rungs.find((r) => r.kind === "call_wall")?.target, "above spot is favorable for LONG");
  assert.equal(longLadder.rungs.find((r) => r.kind === "put_wall")?.target, undefined, "below spot is unfavorable for LONG");

  const shortPlay = fixturePlay({ direction: "SHORT" });
  const shortCtx = fixtureCtx({
    play: shortPlay,
    vector: fixtureVec({
      spot: 100,
      gexWalls: { callWalls: [{ strike: 110 }], putWalls: [{ strike: 90 }] },
    }),
    ecosystem: null,
  });
  const shortLadder = buildStructureLadder(shortCtx, shortPlay, "open")!;
  assert.ok(shortLadder.rungs.find((r) => r.kind === "put_wall")?.target, "below spot is favorable for SHORT");
  assert.equal(shortLadder.rungs.find((r) => r.kind === "call_wall")?.target, undefined, "above spot is unfavorable for SHORT");
});

// ── Cross-desk agreement tri-state (point 3) ────────────────────────────────

function gexEco(over: Record<string, unknown> = {}): EcosystemContext {
  return {
    gex_positioning: { spot: 100, flip: 95, matrix_age_sec: 10, freshness: "live", ...over },
  } as unknown as EcosystemContext;
}

test("buildStructureLadder: crossDeskAgreement is ALIGNED when Vector's own posture matches the matrix-implied one", () => {
  const play = fixturePlay({ direction: "LONG" });
  // spot(100) > gex.flip(95) -> matrix implies "long"; Vector's own regime read also says "long".
  const ctx = fixtureCtx({
    play,
    vector: fixtureVec({ spot: 100, regime: { posture: "long" } }),
    ecosystem: gexEco(),
  });
  const ladder = buildStructureLadder(ctx, play, "open")!;
  assert.deepEqual(ladder.crossDeskAgreement, { status: "aligned" });
});

test("buildStructureLadder: crossDeskAgreement is DISAGREEMENT when Vector's own posture contradicts the matrix-implied one", () => {
  const play = fixturePlay({ direction: "LONG" });
  // spot(100) > gex.flip(95) -> matrix implies "long"; Vector's own read says "short" — a genuine
  // disagreement between two independently-computed flip estimates, exactly what a single-source
  // competitor panel could never surface.
  const ctx = fixtureCtx({
    play,
    vector: fixtureVec({ spot: 100, regime: { posture: "short" } }),
    ecosystem: gexEco(),
  });
  const ladder = buildStructureLadder(ctx, play, "open")!;
  assert.equal(ladder.crossDeskAgreement?.status, "disagreement");
  assert.match(ladder.crossDeskAgreement!.note ?? "", /short gamma/);
  assert.match(ladder.crossDeskAgreement!.note ?? "", /long gamma/);
});

test("buildStructureLadder: crossDeskAgreement is OMITTED (never forced) when Vector's own read is unknown/absent", () => {
  const play = fixturePlay({ direction: "LONG" });
  const unknownCtx = fixtureCtx({
    play,
    vector: fixtureVec({ spot: 100, regime: { posture: "unknown" } }),
    ecosystem: gexEco(),
  });
  const absentCtx = fixtureCtx({
    play,
    vector: fixtureVec({ spot: 100, regime: null }),
    ecosystem: gexEco(),
  });
  assert.equal(buildStructureLadder(unknownCtx, play, "open")!.crossDeskAgreement, undefined);
  assert.equal(buildStructureLadder(absentCtx, play, "open")!.crossDeskAgreement, undefined);
});

test("buildStructureLadder: crossDeskAgreement is OMITTED when there is no independent GEX-matrix flip to compare against", () => {
  const play = fixturePlay({ direction: "LONG" });
  const ctx = fixtureCtx({
    play,
    // gammaFlip present so the ladder has a rung to build from; no ecosystem/GEX matrix at all —
    // there is nothing independent of Vector to compare its posture read against.
    vector: fixtureVec({ spot: 100, gammaFlip: 110, regime: { posture: "long" } }),
    ecosystem: null,
  });
  const ladder = buildStructureLadder(ctx, play, "open")!;
  assert.ok(ladder);
  assert.equal(ladder.crossDeskAgreement, undefined);
});

// ── Archetype track-record citation (point 4, Largo C6 omission discipline) ─

test("buildStructureLadder: cites the archetype track record ONLY when the bucket has graduated", () => {
  const play = fixturePlay({ direction: "LONG", archetype: "BREAKOUT" });
  const vec = fixtureVec({ spot: 100, gammaFlip: 110 });

  const graduatedCtx = fixtureCtx({
    play,
    vector: vec,
    archetypeTrackRecord: trackRecordSnapshot({
      BREAKOUT: trackRecordEntry({ graduated: true, winRatePct: 68, wilsonLbPct: 55, n: 40 }),
    }),
  });
  const graduatedLadder = buildStructureLadder(graduatedCtx, play, "open")!;
  assert.deepEqual(graduatedLadder.archetypeTrackRecord, {
    archetypeLabel: "Breakout continuation",
    winRatePct: 68,
    wilsonLbPct: 55,
    n: 40,
  });

  const ungraduatedCtx = fixtureCtx({
    play,
    vector: vec,
    archetypeTrackRecord: trackRecordSnapshot({
      BREAKOUT: trackRecordEntry({ graduated: false }),
    }),
  });
  assert.equal(
    buildStructureLadder(ungraduatedCtx, play, "open")!.archetypeTrackRecord,
    undefined,
    "never cite an ungraduated bucket — Largo C6 omission, not a discounted number",
  );

  const coldCacheCtx = fixtureCtx({ play, vector: vec, archetypeTrackRecord: null });
  assert.equal(buildStructureLadder(coldCacheCtx, play, "open")!.archetypeTrackRecord, undefined);

  const noArchetypeCtx = fixtureCtx({
    play: fixturePlay({ direction: "LONG", archetype: null }),
    vector: vec,
    archetypeTrackRecord: trackRecordSnapshot({ BREAKOUT: trackRecordEntry({ graduated: true }) }),
  });
  assert.equal(
    buildStructureLadder(noArchetypeCtx, noArchetypeCtx.play, "open")!.archetypeTrackRecord,
    undefined,
  );
});

// ── WATCH bucket (still builds — the ladder is useful pre-entry too) ────────

test("buildStructureLadder: builds for a WATCH candidate too (forward risk/reward is exactly the pre-entry question)", () => {
  const play = fixturePlay({ status: "WATCH", direction: "LONG" });
  const ctx = fixtureCtx({ play, vector: fixtureVec({ spot: 100, gammaFlip: 110 }) });
  const ladder = buildStructureLadder(ctx, play, "watch");
  assert.ok(ladder);
  assert.ok(ladder!.rungs.length > 0);
  assert.equal(ladder!.positionState, "watch");
});

// ── positionState — the OPEN-position "stop is a live estimate, not the real committed one" ─────
// caveat this field exists to drive (see StructureLadder.positionState's own header). `stop` is
// ALWAYS a fresh recompute from today's spot, never `TerminalPlay`'s real per-position value (not
// threaded onto the type today) — positionState just tells the UI which case it's in so an
// OPEN/HOLD/TRIM read can say so, instead of presenting a recompute as the position's real,
// frozen risk level.

test("buildStructureLadder: positionState is \"open\" for an already-committed OPEN position", () => {
  const play = fixturePlay({ status: "OPEN", direction: "LONG" });
  const ctx = fixtureCtx({ play, vector: fixtureVec({ spot: 100, gammaFlip: 110 }) });
  const ladder = buildStructureLadder(ctx, play, "open");
  assert.equal(ladder!.positionState, "open");
});

// ── Gatekeeper (competitor-panel parity, 2026-09-13) ─────────────────────────
// Every favorable-side rung except the single farthest one is a "gatekeeper": clearing it is
// what exposes the next rung out. The farthest favorable rung is never a gatekeeper.

test("buildStructureLadder: nearer favorable rungs are gatekeepers, the farthest one is not", () => {
  const play = fixturePlay({ direction: "LONG" });
  const vec = fixtureVec({
    spot: 100,
    gammaFlip: 105, // favorable, nearer (+5)
    gexWalls: { callWalls: [{ strike: 112 }], putWalls: [{ strike: 95 }] }, // call wall favorable, farther (+12)
  });
  const ctx = fixtureCtx({ play, vector: vec, ecosystem: null });
  const ladder = buildStructureLadder(ctx, play, "open");
  assert.ok(ladder);

  const byKind = Object.fromEntries(ladder!.rungs.map((r) => [r.kind, r]));
  assert.equal(byKind.gamma_flip.target?.gatekeeper, true, "nearer favorable rung IS a gatekeeper");
  assert.equal(byKind.call_wall.target?.gatekeeper, false, "farthest favorable rung is NOT a gatekeeper");
  // The unfavorable-side put wall never carries a target at all, so gatekeeper is moot for it.
  assert.equal(byKind.put_wall.target, undefined);
});

test("buildStructureLadder: a single favorable rung is never a gatekeeper (nothing further out to open)", () => {
  const play = fixturePlay({ direction: "LONG" });
  const vec = fixtureVec({ spot: 100, gammaFlip: 110 });
  const ctx = fixtureCtx({ play, vector: vec, ecosystem: null });
  const ladder = buildStructureLadder(ctx, play, "open");
  assert.ok(ladder);
  const flip = ladder!.rungs.find((r) => r.kind === "gamma_flip");
  assert.equal(flip?.target?.gatekeeper, false);
});

// ── Risk — the other side ────────────────────────────────────────────────────
// The nearest real rung WITHOUT a target (i.e. on the unfavorable side) — always a reference into
// the same rungs array, never a second independently-derived level.

test("buildStructureLadder: riskTheOtherSide names the nearest unfavorable-side rung", () => {
  const play = fixturePlay({ direction: "LONG" });
  const vec = fixtureVec({
    spot: 100,
    gammaFlip: 110,
    gexWalls: { callWalls: [{ strike: 115 }], putWalls: [{ strike: 97 }] }, // put wall unfavorable, nearest
    maxPain: 90, // also unfavorable (neutral role) but farther than the put wall
  });
  const ctx = fixtureCtx({ play, vector: vec, ecosystem: null });
  const ladder = buildStructureLadder(ctx, play, "open");
  assert.ok(ladder);
  assert.ok(ladder!.riskTheOtherSide, "an unfavorable-side rung exists and must be named");
  assert.equal(ladder!.riskTheOtherSide!.kind, "put_wall", "nearest unfavorable rung, not just any of them");
  assert.equal(ladder!.riskTheOtherSide!.price, 97);
  assert.equal(ladder!.riskTheOtherSide!.role, "support");
});

test("buildStructureLadder: riskTheOtherSide is OMITTED when every rung sits on the favorable side", () => {
  const play = fixturePlay({ direction: "LONG" });
  // Only favorable-side (above spot) structure — nothing on the wrong side to name.
  const vec = fixtureVec({ spot: 100, gammaFlip: 105, gexWalls: { callWalls: [{ strike: 112 }] } });
  const ctx = fixtureCtx({ play, vector: vec, ecosystem: null });
  const ladder = buildStructureLadder(ctx, play, "open");
  assert.ok(ladder);
  assert.equal(ladder!.riskTheOtherSide, undefined);
});

test("buildStructureLadder: riskTheOtherSide flips sides correctly for a SHORT thesis", () => {
  const play = fixturePlay({ direction: "SHORT" });
  const vec = fixtureVec({
    spot: 100,
    gammaFlip: 90, // favorable for SHORT (below spot)
    gexWalls: { callWalls: [{ strike: 103 }], putWalls: [{ strike: 80 }] }, // call wall above spot = unfavorable for SHORT
  });
  const ctx = fixtureCtx({ play, vector: vec, ecosystem: null });
  const ladder = buildStructureLadder(ctx, play, "open");
  assert.ok(ladder);
  assert.ok(ladder!.riskTheOtherSide);
  assert.equal(ladder!.riskTheOtherSide!.kind, "call_wall");
  assert.equal(ladder!.riskTheOtherSide!.price, 103);
});

// BUG FIX (2026-09-15, Ask Largo standing mandate, live repro AAPL/CG/ENPH/PEGA): a nearer neutral
// pivot (gamma_flip/max_pain/magnet) used to win over a farther but genuine support/resistance wall
// on the unfavorable side, directly contradicting roleForKind's own documented stance that these
// pivots are "NOT hard support/resistance... never as a wall a price bounces off." Live PEGA repro
// shape: a gamma-magnet pivot sat much nearer than the real put wall, and the old code named the
// pivot "the nearest real structure" while hiding a put wall 13 points farther out.
test("buildStructureLadder: riskTheOtherSide prefers a farther REAL wall over a nearer NEUTRAL pivot (live PEGA repro)", () => {
  const play = fixturePlay({ direction: "LONG" });
  const vec = fixtureVec({
    spot: 100,
    magnet: { strike: 95 }, // neutral, NEARER (5% away)
    gexWalls: { putWalls: [{ strike: 80 }] }, // support, FARTHER (20% away) but a real wall
  });
  const ctx = fixtureCtx({ play, vector: vec, ecosystem: null });
  const ladder = buildStructureLadder(ctx, play, "open");
  assert.ok(ladder);
  assert.ok(ladder!.riskTheOtherSide);
  assert.equal(
    ladder!.riskTheOtherSide!.kind,
    "put_wall",
    "must prefer the farther real wall over the nearer neutral pivot",
  );
  assert.equal(ladder!.riskTheOtherSide!.price, 80);
  assert.equal(ladder!.riskTheOtherSide!.role, "support");
});

test("buildStructureLadder: riskTheOtherSide falls back to a neutral pivot when NO real wall exists unfavorably (unchanged GLXY-shape case)", () => {
  const play = fixturePlay({ direction: "LONG" });
  const vec = fixtureVec({
    spot: 100,
    magnet: { strike: 95 }, // neutral, the ONLY unfavorable-side rung — no real wall to prefer
  });
  const ctx = fixtureCtx({ play, vector: vec, ecosystem: null });
  const ladder = buildStructureLadder(ctx, play, "open");
  assert.ok(ladder);
  assert.ok(ladder!.riskTheOtherSide, "must still fall back to the neutral pivot when nothing else exists");
  assert.equal(ladder!.riskTheOtherSide!.kind, "magnet");
  assert.equal(ladder!.riskTheOtherSide!.role, "neutral");
});
