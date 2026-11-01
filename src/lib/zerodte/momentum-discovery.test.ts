import test from "node:test";
import assert from "node:assert/strict";
import { evaluateMomentumDiscoveryCandidate } from "./momentum-discovery.ts";
import type { MomentumBar } from "./momentum-acceleration.ts";
import type { ChainCandidate } from "./strike-reachability.ts";

const etMs = (h: number, m = 0) => Date.parse(`2026-10-21T${String(h + 4).padStart(2, "0")}:${String(m).padStart(2, "0")}:00Z`);
function bar(h: number, m: number, c: number): MomentumBar {
  return { t: etMs(h, m), h: c + 0.01, l: c - 0.01, c, v: 1000 };
}
function upBars(): MomentumBar[] {
  const bars: MomentumBar[] = [];
  for (let m = 0; m < 5; m++) bars.push(bar(10, m, 100 + m * 0.04));
  for (let m = 5; m < 10; m++) bars.push(bar(10, m, 100.2 + (m - 5) * 0.4));
  return bars;
}
function flatBars(): MomentumBar[] {
  const bars: MomentumBar[] = [];
  for (let m = 0; m < 10; m++) bars.push(bar(10, m, 100));
  return bars;
}
function chain(): ChainCandidate[] {
  return [
    { strike: 102, side: "call", bid: 1.0, ask: 1.05, oi: 500, iv: 0.3 },
    { strike: 105, side: "call", bid: 0.6, ask: 0.65, oi: 400, iv: 0.3 },
    { strike: 98, side: "put", bid: 0.5, ask: 0.55, oi: 300, iv: 0.3 },
  ];
}

test("evaluateMomentumDiscoveryCandidate: no setup detected on flat tape -> detected=false, no ranked contracts", () => {
  const r = evaluateMomentumDiscoveryCandidate({
    bars: flatBars(),
    referenceLevel: { high: 101, low: 99 },
    rvolRatio: 1.0,
    minutesRemaining: 60,
    candidates: chain(),
  });
  assert.equal(r.detected, false);
  assert.equal(r.direction, null);
  assert.equal(r.ranked_contracts.length, 0);
});

test("evaluateMomentumDiscoveryCandidate: confirmed acceleration + high RVOL -> detected=true, direction long, contracts ranked", () => {
  const r = evaluateMomentumDiscoveryCandidate({
    bars: upBars(),
    referenceLevel: { high: 101, low: 99 },
    rvolRatio: 2.5,
    minutesRemaining: 120,
    candidates: chain(),
  });
  assert.equal(r.detected, true);
  assert.equal(r.direction, "long");
  assert.ok(r.ranked_contracts.length > 0);
  assert.equal(r.ranked_contracts[0]!.side, "call", "long direction ranks calls only");
});

test("evaluateMomentumDiscoveryCandidate: confirmed acceleration but RVOL below floor -> NOT detected (volume confirmation required)", () => {
  const r = evaluateMomentumDiscoveryCandidate({
    bars: upBars(),
    referenceLevel: { high: 101, low: 99 },
    rvolRatio: 0.8,
    minutesRemaining: 120,
    candidates: chain(),
  });
  assert.equal(r.detected, false, "a confirmed price break without real volume behind it is not a detected setup");
  assert.equal(r.ranked_contracts.length, 0, "no contracts ranked when no setup is detected");
});

test("evaluateMomentumDiscoveryCandidate: null rvolRatio (unavailable) does not auto-pass or auto-fail — reported, not guessed", () => {
  const r = evaluateMomentumDiscoveryCandidate({
    bars: upBars(),
    referenceLevel: { high: 101, low: 99 },
    rvolRatio: null,
    minutesRemaining: 120,
    candidates: chain(),
  });
  assert.equal(r.detected, false, "missing RVOL data cannot satisfy the volume-confirmation requirement");
  assert.equal(r.rvol_ratio, null);
});

test("evaluateMomentumDiscoveryCandidate: reports the full momentum read even when not detected, for diagnostics", () => {
  const r = evaluateMomentumDiscoveryCandidate({
    bars: upBars(),
    referenceLevel: { high: 1000, low: 500 }, // break disagrees -> not confirmed
    rvolRatio: 3.0,
    minutesRemaining: 120,
    candidates: chain(),
  });
  assert.equal(r.detected, false);
  assert.equal(r.momentum.accelerating, true, "the underlying acceleration read is still surfaced");
  assert.equal(r.momentum.confirmed, false);
});

test("evaluateMomentumDiscoveryCandidate: custom rvolFloor is honored", () => {
  const r = evaluateMomentumDiscoveryCandidate({
    bars: upBars(),
    referenceLevel: { high: 101, low: 99 },
    rvolRatio: 1.2,
    rvolFloor: 1.0,
    minutesRemaining: 120,
    candidates: chain(),
  });
  assert.equal(r.detected, true, "1.2 clears a 1.0 floor even though it would not clear the default");
});
