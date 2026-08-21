import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreWallIntegrity, scoreTopWalls, integrityByStrike, beadIntegrityTierMaps } from "./vector-wall-integrity";
import type { GexWalls } from "@/lib/providers/gex-wall-levels";
import type { WallHistorySample } from "./vector-wall-history";

const walls: GexWalls = {
  callWalls: [
    { strike: 7600, pct: 100 },
    { strike: 7650, pct: 30 },
  ],
  putWalls: [
    { strike: 7500, pct: 55 },
    { strike: 7490, pct: 50 }, // near-equal → clustered / low isolation
  ],
};
// Strongest wall across both sides = the 7600 call at 100.
const REF = 100;

function sample(time: number, w: GexWalls): WallHistorySample {
  return { time, walls: w, gammaFlip: null };
}

// A rail where 7600 is present every sample (persistent), 7650 never.
const persistentHistory: WallHistorySample[] = Array.from({ length: 30 }, (_, i) =>
  sample(i, { callWalls: [{ strike: 7600, pct: 90 }], putWalls: [{ strike: 7500, pct: 50 }] })
);

test("scoreWallIntegrity: a dominant wall present in every rail sample scores FIRM", () => {
  const r = scoreWallIntegrity(walls.callWalls[0]!, "call", walls.callWalls, persistentHistory, REF)!;
  assert.equal(r.tier, "firm");
  assert.ok(r.score >= 70, `score ${r.score} should be >=70`);
  assert.equal(r.factors.persistence, 1, "present in every rail sample");
  assert.equal(r.factors.strength, 1, "the strongest wall anchors strength at 1.0");
  assert.ok(r.factors.isolation >= 0.5, "towers over the 7650 wall");
  // This fixture's samples are one second apart, so the honest claim is 29 seconds — which is
  // exactly why the note no longer says "of session". The old assertion here read
  // `held 100% of session` off a 29-SECOND rail and passed.
  assert.match(r.note, /7600C firm — held 100% of last 29s, dominant/);
});

test("REGRESSION: realistic small absolute pct — the dominant persistent wall is FIRM, not 'thin'", () => {
  // GEX pct is a wall's share of the WHOLE chain's gamma, so the top wall is only a
  // few % (here 6), not 100. The old `pct/100` made strength ~0.06 and a wall that
  // held all session still read "thin". Relative normalization fixes it.
  const realWalls: GexWalls = {
    callWalls: [
      { strike: 7600, pct: 6 },
      { strike: 7650, pct: 2 },
    ],
    putWalls: [{ strike: 7500, pct: 3 }],
  };
  const hist = Array.from({ length: 30 }, (_, i) =>
    sample(i, { callWalls: [{ strike: 7600, pct: 6 }], putWalls: [] })
  );
  const r = scoreTopWalls(realWalls, hist).call!;
  assert.equal(r.factors.strength, 1, "6%-of-chain top wall still normalizes to full strength");
  assert.equal(r.tier, "firm", "held-all-session dominant wall must NOT read thin");
  assert.ok(r.score >= 70, `score ${r.score} should be >=70`);
});

test("scoreWallIntegrity: a weaker, clustered wall is penalized vs the dominant one", () => {
  const putTop = scoreWallIntegrity(walls.putWalls[0]!, "put", walls.putWalls, persistentHistory, REF)!;
  const callTop = scoreWallIntegrity(walls.callWalls[0]!, "call", walls.callWalls, persistentHistory, REF)!;
  assert.ok(putTop.factors.isolation < 0.2, "put wall is clustered (7500 vs 7490)");
  assert.ok(putTop.factors.strength < callTop.factors.strength, "put (55/100) weaker than call (100/100)");
  assert.ok(putTop.score < callTop.score, "clustered/weaker wall must score below the dominant one");
});

test("scoreWallIntegrity: no history → persistence is neutral 0.5 (never fabricated as proven)", () => {
  const r = scoreWallIntegrity(walls.callWalls[0]!, "call", walls.callWalls, [], REF)!;
  assert.equal(r.factors.persistence, 0.5);
  assert.match(r.note, /no rail yet/);
});

test("scoreWallIntegrity: a seed-only rail (< 3 samples) reads 'as-of-close', not 'held 100% of session'", () => {
  // Off-hours for an unrecorded ticker, seedWallHistoryForDisplay drops ONE as-of-close
  // sample. A one-sample rail used to make every wall claim "held 100% of session" — an
  // overclaim (nothing was observed holding over time). Persistence must stay neutral and
  // the note must not assert session-long holding.
  const seed = [sample(0, { callWalls: [{ strike: 7600, pct: 90 }], putWalls: [] })];
  const r = scoreWallIntegrity(walls.callWalls[0]!, "call", walls.callWalls, seed, REF)!;
  assert.equal(r.factors.persistence, 0.5, "one-sample rail is unknown, not proven");
  assert.match(r.note, /as-of-close/);
  assert.doesNotMatch(r.note, /held \d+% of session/);
});

test("scoreWallIntegrity: single-wall side is fully isolated", () => {
  const one = scoreWallIntegrity({ strike: 7600, pct: 80 }, "call", [{ strike: 7600, pct: 80 }], [], 80);
  assert.equal(one!.factors.isolation, 1);
});

test("scoreWallIntegrity: null/garbage wall or zero ref → null/zero, never throws", () => {
  assert.equal(scoreWallIntegrity({ strike: 0, pct: 50 }, "call", [], [], REF), null);
  assert.equal(scoreWallIntegrity(undefined as never, "call", [], [], REF), null);
  const zeroRef = scoreWallIntegrity({ strike: 7600, pct: 5 }, "call", [{ strike: 7600, pct: 5 }], [], 0);
  assert.equal(zeroRef!.factors.strength, 0, "zero ref → strength 0, no divide-by-zero");
});

test("scoreTopWalls: returns the top call + top put, null side when absent", () => {
  const r = scoreTopWalls(walls, persistentHistory);
  assert.equal(r.call?.strike, 7600);
  assert.equal(r.put?.strike, 7500);
  const noPut = scoreTopWalls({ callWalls: walls.callWalls, putWalls: [] }, persistentHistory);
  assert.equal(noPut.put, null);
  assert.equal(scoreTopWalls(null).call, null);
});

test("integrityByStrike: scores EVERY wall per side, keyed by raw strike", () => {
  const r = integrityByStrike(walls, persistentHistory);
  // Both call strikes present in the map (not just the top one, unlike scoreTopWalls).
  assert.deepEqual([...r.call.keys()].sort((a, b) => a - b), [7600, 7650]);
  assert.deepEqual([...r.put.keys()].sort((a, b) => a - b), [7490, 7500]);
  // The map's verdict for the top wall is byte-identical to scoreTopWalls — one source of truth.
  const top = scoreTopWalls(walls, persistentHistory);
  assert.deepEqual(r.call.get(7600), top.call);
  assert.deepEqual(r.put.get(7500), top.put);
});

test("integrityByStrike: the dominant persistent wall rings FIRM, its weak clustered peer does not", () => {
  const r = integrityByStrike(walls, persistentHistory);
  assert.equal(r.call.get(7600)!.tier, "firm", "dominant, held-all-session → firm ring");
  // 7650 is weak (30 vs ref 100) and never in the rail → not firm.
  assert.notEqual(r.call.get(7650)!.tier, "firm");
});

test("integrityByStrike: shared refMaxPct across BOTH sides — a put isn't over-scored by its own max", () => {
  // The strongest wall is the 7600 call (100); the top put (55) must be scored against 100, not 55,
  // so its strength factor is ~0.55, not 1.0. This is what keeps the ring consistent cross-side.
  const r = integrityByStrike(walls, persistentHistory);
  assert.ok(r.put.get(7500)!.factors.strength < 1, "put strength normalized against the 100 call king");
});

test("integrityByStrike: null / empty sides → empty maps, never fabricated entries", () => {
  const r = integrityByStrike(null);
  assert.equal(r.call.size, 0);
  assert.equal(r.put.size, 0);
  const oneSide = integrityByStrike({ callWalls: [{ strike: 7600, pct: 10 }], putWalls: [] });
  assert.equal(oneSide.call.size, 1);
  assert.equal(oneSide.put.size, 0);
});

test("beadIntegrityTierMaps: GEX lens → strike→tier maps; VEX / empty → null", () => {
  const maps = beadIntegrityTierMaps(persistentHistory, "gex");
  assert.ok(maps);
  assert.equal(maps!.call.get(7600), "firm");
  assert.equal(beadIntegrityTierMaps(persistentHistory, "vex"), null);
  assert.equal(beadIntegrityTierMaps([], "gex"), null);
});

/**
 * The note must not claim more scope than the persistence window actually observed.
 *
 * `persistenceFor` measures over PERSISTENCE_WINDOW = 60 TRAILING SAMPLES, and 60 samples is a
 * different duration on every recorder lane: the universe recorder writes oracle tickers every 5s
 * (~5 minutes) and everything else every 15s (~15 minutes), and a rail compacted at the old end
 * carries 15s buckets there too. An RTH session is 390 minutes. So "held 100% of session" was, on
 * SPX, a claim about the last 1.3% of the session — a wall four minutes old read as having held
 * all day, on a panel members use to decide whether a level will hold.
 *
 * This file already knew the failure mode: MIN_RAIL_SAMPLES exists because a ONE-sample seed rail
 * made every wall say "held 100% of session", described in its own comment as "an overclaim, since
 * nothing was actually observed holding over time". Sixty samples said the same wrong thing.
 */
test("REGRESSION: the note reports the window it measured, never 'of session'", () => {
  // 5s cadence — the oracle recorder lane. 60 samples = 5 minutes.
  const fiveSecond: WallHistorySample[] = Array.from({ length: 60 }, (_, i) =>
    sample(i * 5, { callWalls: [{ strike: 7600, pct: 90 }], putWalls: [] })
  );
  const r = scoreWallIntegrity(walls.callWalls[0]!, "call", walls.callWalls, fiveSecond, REF)!;

  assert.doesNotMatch(r.note, /of session/, "a 5-minute observation must not be sold as a session");
  assert.match(r.note, /held 100% of last 5m/);
});

test("the reported span follows the recorder lane, because the sample COUNT does not", () => {
  // Identical sample count, identical persistence, different lane — and now a different claim.
  const mk = (stepSec: number) =>
    Array.from({ length: 60 }, (_, i) =>
      sample(i * stepSec, { callWalls: [{ strike: 7600, pct: 90 }], putWalls: [] })
    );
  const oracle = scoreWallIntegrity(walls.callWalls[0]!, "call", walls.callWalls, mk(5), REF)!;
  const onDemand = scoreWallIntegrity(walls.callWalls[0]!, "call", walls.callWalls, mk(15), REF)!;

  assert.equal(oracle.factors.persistence, onDemand.factors.persistence, "same evidence strength");
  assert.match(oracle.note, /last 5m/);
  assert.match(onDemand.note, /last 15m/, "15s cadence covers three times the wall-clock");
});

test("a long rail reads in hours, and a degenerate one falls back rather than lying", () => {
  const hourPlus: WallHistorySample[] = Array.from({ length: 60 }, (_, i) =>
    sample(i * 80, { callWalls: [{ strike: 7600, pct: 90 }], putWalls: [] })
  );
  assert.match(
    scoreWallIntegrity(walls.callWalls[0]!, "call", walls.callWalls, hourPlus, REF)!.note,
    /last 1h19m/
  );

  // Every sample stamped at the same instant: there is no span to report. Say "observed rail"
  // rather than inventing "0s", which would read as a broken panel rather than a thin one.
  const zeroSpan: WallHistorySample[] = Array.from({ length: 10 }, () =>
    sample(1000, { callWalls: [{ strike: 7600, pct: 90 }], putWalls: [] })
  );
  const flat = scoreWallIntegrity(walls.callWalls[0]!, "call", walls.callWalls, zeroSpan, REF)!;
  assert.match(flat.note, /held 100% of observed rail/);
  assert.doesNotMatch(flat.note, /0s|NaN|undefined/);
});

test("the persistence FACTOR is unchanged — this fix touches the label, not the score", () => {
  // Deliberate scope line. 35% of the integrity score rides on persistence, and re-basing its
  // window would move tiers (firm/moderate/thin) on a live trading surface. That is a separate,
  // evidence-backed change; it must not ride along inside a wording fix.
  const r = scoreWallIntegrity(walls.callWalls[0]!, "call", walls.callWalls, persistentHistory, REF)!;
  assert.equal(r.factors.persistence, 1);
  assert.equal(r.factors.isolation, 0.7, "(100 - 30) / 100 against the 7650 peer");
  // 0.45×1 (strength) + 0.35×1 (persistence) + 0.2×0.7 (isolation) = 0.94
  assert.equal(r.score, 94);
  assert.equal(r.tier, "firm");
});
