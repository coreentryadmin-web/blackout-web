import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyArchetype,
  archetypeInputsFromReads,
  type ArchetypeInputs,
  type ArchetypeReadExtras,
} from "./archetype.ts";
import type { SwingReads } from "../swing-signals.ts";
import type { ZeroDteFlowAccumulation } from "../zerodte/flow-accumulation-context.ts";
import { SWING_ARCHETYPES, ARCHETYPE_PRIORITY } from "./taxonomy.ts";

// A base input where every field is absent (null) — fixtures light up exactly their archetype's cluster.
const EMPTY: ArchetypeInputs = { direction: "LONG" };

// One high-signal fixture per archetype (its own cluster maxed; everything else absent).
const FIXTURES: Record<string, ArchetypeInputs> = {
  BREAKOUT: { direction: "LONG", nearRangeExtreme01: 0.95, breakoutQuality01: 0.9, volumeExpansion01: 0.85 },
  PULLBACK_CONTINUATION: { direction: "LONG", trendStack01: 0.9, retraceToSupport01: 0.88 },
  MEAN_REVERSION: { direction: "LONG", oversold01: 0.92 },
  FAILED_BREAKDOWN: { direction: "LONG", reclaim01: 0.9 },
  POST_EARNINGS_DRIFT: { direction: "LONG", earningsGapRecent01: 0.9, postEarningsDrift01: 0.85 },
  FLOW_ACCUMULATION: { direction: "LONG", accumPersistence01: 0.95 },
  SECTOR_ROTATION: { direction: "LONG", sectorLeadership01: 0.9, relStrength01: 0.88 },
  EVENT_DRIVEN: { direction: "LONG", catalystInWindow01: 0.93 },
};

test("each fitX fires on its own fixture (that archetype wins) and stays absent/low elsewhere", () => {
  for (const a of SWING_ARCHETYPES) {
    const v = classifyArchetype(FIXTURES[a]);
    assert.equal(v.archetype, a, `${a} fixture should classify as ${a}`);
    assert.ok(v.confidence >= 0.8, `${a} fixture confidence high (${v.confidence})`);
    // every OTHER archetype's fit is null (no cross-cluster leakage) on this single-cluster fixture.
    for (const other of SWING_ARCHETYPES) {
      if (other === a) continue;
      assert.equal(v.fits[other], null, `${other} should have null fit on the ${a} fixture`);
    }
  }
});

test("margin confidence = topFit − secondFit is exposed and non-negative", () => {
  const v = classifyArchetype({
    direction: "LONG",
    breakoutQuality01: 0.9,
    nearRangeExtreme01: 0.9,
    volumeExpansion01: 0.9, // BREAKOUT ≈ 0.9
    oversold01: 0.4, // MEAN_REVERSION = 0.4
  });
  assert.equal(v.archetype, "BREAKOUT");
  assert.ok(v.margin > 0 && v.margin <= 1);
  assert.ok(Math.abs(v.margin - (0.9 - 0.4)) < 1e-9);
});

test("tie within the confidence margin resolves by ARCHETYPE_PRIORITY (most-specific-first)", () => {
  // BREAKOUT and EVENT_DRIVEN both fit ~0.80. EVENT_DRIVEN precedes BREAKOUT in ARCHETYPE_PRIORITY → it wins.
  const v = classifyArchetype({
    direction: "LONG",
    nearRangeExtreme01: 0.8,
    breakoutQuality01: 0.8,
    volumeExpansion01: 0.8, // BREAKOUT = 0.80
    catalystInWindow01: 0.8, // EVENT_DRIVEN = 0.80
  });
  assert.equal(v.archetype, "EVENT_DRIVEN");
  assert.ok(
    ARCHETYPE_PRIORITY.indexOf("EVENT_DRIVEN") < ARCHETYPE_PRIORITY.indexOf("BREAKOUT"),
    "priority order sanity",
  );
  assert.ok(v.margin <= 0.05, "a tie has a small margin");
});

test("tie-break never overrides a clearly higher fit (margin beyond EPS ⇒ numeric max wins)", () => {
  // BREAKOUT 0.90 clearly beats EVENT_DRIVEN 0.50 (margin 0.40 > EPS) even though EVENT_DRIVEN is more specific.
  const v = classifyArchetype({
    direction: "LONG",
    nearRangeExtreme01: 0.9,
    breakoutQuality01: 0.9,
    volumeExpansion01: 0.9,
    catalystInWindow01: 0.5,
  });
  assert.equal(v.archetype, "BREAKOUT");
});

test("thin data → archetype null (no grounded fit, or no fit clears the evidence floor)", () => {
  // Zero inputs → no present fit at all.
  assert.equal(classifyArchetype(EMPTY).archetype, null);
  // A single WEAK input below the floor → unclassified (honest), even though its fit is present.
  const weak1 = classifyArchetype({ direction: "LONG", oversold01: 0.2 });
  assert.equal(weak1.archetype, null);
  // Several inputs but all weak (below the evidence floor) → unclassified.
  const weak = classifyArchetype({ direction: "LONG", oversold01: 0.2, catalystInWindow01: 0.2 });
  assert.equal(weak.archetype, null);
  assert.match(weak.reason, /[Tt]hin|floor/);
});

test("SHORT symmetry (direct inputs): a mirror SHORT classifies to the same archetype+fit as its LONG mirror", () => {
  for (const a of SWING_ARCHETYPES) {
    const long = FIXTURES[a];
    const short: ArchetypeInputs = { ...long, direction: "SHORT" }; // identical signed fields, opposite side
    const vl = classifyArchetype(long);
    const vs = classifyArchetype(short);
    assert.equal(vs.archetype, vl.archetype, `${a}: SHORT mirror archetype matches LONG`);
    assert.equal(vs.confidence, vl.confidence, `${a}: SHORT mirror confidence matches LONG`);
    assert.deepEqual(vs.fits, vl.fits, `${a}: SHORT mirror fits match LONG`);
  }
});

// ── reads-level symmetry through archetypeInputsFromReads (the canonical direction-signing) ──
function accum(direction: "bull" | "bear", days: number): ZeroDteFlowAccumulation {
  return {
    direction,
    strength: 80,
    days,
    net_signed_premium: direction === "bull" ? 5e6 : -5e6,
    magnet_strike: 100,
    magnet_side: direction === "bull" ? "call" : "put",
    aligned: true,
  };
}

test("archetypeInputsFromReads: LONG bull reads and their mirror-SHORT bear reads produce identical signed inputs", () => {
  const extras: ArchetypeReadExtras = { catalystInWindow01: 0.9 };
  const longReads: SwingReads = {
    accumulation: accum("bull", 4),
    flowWindowDays: 5,
    returnPct10d: 8, // up move
    spyReturnPct10d: 1,
    priceAboveEma20: true,
    ema20AboveEma50: true,
    ema50Rising: true,
  };
  // Mirror SHORT: bear lean, negated raw price inputs, inverted (bearish) stack — signs to the same magnitudes.
  const shortReads: SwingReads = {
    accumulation: accum("bear", 4),
    flowWindowDays: 5,
    returnPct10d: -8,
    spyReturnPct10d: -1,
    priceAboveEma20: false,
    ema20AboveEma50: false,
    ema50Rising: false,
  };
  const li = archetypeInputsFromReads(longReads, extras);
  const si = archetypeInputsFromReads(shortReads, extras);
  assert.equal(li.direction, "LONG");
  assert.equal(si.direction, "SHORT");
  // direction-signed derived fields match
  assert.equal(li.trendStack01, si.trendStack01);
  assert.equal(li.relStrength01, si.relStrength01);
  assert.equal(li.accumPersistence01, si.accumPersistence01);
  // → same archetype + fit (the whole point: conviction, not sign, drives the bucket)
  assert.deepEqual(classifyArchetype(si).fits, classifyArchetype(li).fits);
  assert.equal(classifyArchetype(si).archetype, classifyArchetype(li).archetype);
});

test("archetypeInputsFromReads: neutral/absent flow → direction null, derived signed fields null (no fabrication)", () => {
  const reads: SwingReads = { accumulation: null, flowWindowDays: 5, returnPct10d: 8, spyReturnPct10d: 1 };
  const i = archetypeInputsFromReads(reads);
  assert.equal(i.direction, null);
  assert.equal(i.relStrength01, null);
  assert.equal(i.accumPersistence01, null);
  assert.equal(i.trendStack01, null);
});
