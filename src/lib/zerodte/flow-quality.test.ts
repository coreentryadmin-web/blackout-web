import { test } from "node:test";
import assert from "node:assert/strict";
import { computeFlowQuality, type FlowPrint } from "./flow-quality.ts";

const T0 = Date.parse("2026-07-23T14:00:00Z");
function p(over: Partial<FlowPrint>): FlowPrint {
  return { premiumUsd: 200_000, askPct: 70, isSweep: false, strike: 100, expiryYmd: "2026-07-23", side: "call", tsMs: T0, size: 100, ...over };
}

/** A strong, real accumulation: 15 growing at-the-ask call prints, half sweeps, one strike, over ~21 min. */
function strongTape(): FlowPrint[] {
  const rows: FlowPrint[] = [];
  for (let i = 0; i < 15; i++) {
    rows.push(p({ premiumUsd: 150_000 + i * 30_000, askPct: 74, isSweep: i % 2 === 0, tsMs: T0 + i * 90_000 }));
  }
  return rows;
}

test("empty tape → zeroed, safe result (never crashes)", () => {
  const q = computeFlowQuality([]);
  assert.equal(q.score, 0);
  assert.equal(q.reason, "no flow");
  assert.equal(q.momentum.accelerating, false);
});

test("a strong accumulation scores high (>75)", () => {
  const q = computeFlowQuality(strongTape());
  assert.ok(q.score > 75, `expected >75, got ${q.score}`);
  assert.equal(q.dominantSide, "call");
  assert.ok(q.dominance > 0.9);
  assert.equal(q.momentum.accelerating, true);
});

test("a single small bid-side print scores low (<20)", () => {
  const q = computeFlowQuality([p({ premiumUsd: 200_000, askPct: 40, isSweep: false })]);
  assert.ok(q.score < 20, `expected <20, got ${q.score}`);
  // its weakness is spread across the components: no depth, no aggression, ~no persistence, no concentration
  assert.ok(q.components.persistence < 1, `lone print persistence should be ~0, got ${q.components.persistence}`);
  assert.equal(q.components.concentration, 0); // lone print can't prove clustering
});

test("bid-side flow (sold premium) kills the aggression component", () => {
  const rows = Array.from({ length: 10 }, (_, i) => p({ askPct: 30, tsMs: T0 + i * 60_000 })); // all under the ask
  const q = computeFlowQuality(rows);
  assert.equal(q.components.aggression, 0);
});

test("momentum: accelerating vs fading is detected from the tape shape", () => {
  const accel = Array.from({ length: 10 }, (_, i) => p({ premiumUsd: 100_000 + i * 50_000, tsMs: T0 + i * 60_000 }));
  const fade = Array.from({ length: 10 }, (_, i) => p({ premiumUsd: 550_000 - i * 50_000, tsMs: T0 + i * 60_000 }));
  assert.equal(computeFlowQuality(accel).momentum.accelerating, true);
  assert.equal(computeFlowQuality(fade).momentum.accelerating, false);
  assert.ok(computeFlowQuality(accel).momentum.netPremiumSlopePerMin > 0);
  assert.ok(computeFlowQuality(fade).momentum.netPremiumSlopePerMin < 0);
});

test("persistence: sustained 20-min tape beats a same-total one-second burst", () => {
  const burst = Array.from({ length: 15 }, () => p({ premiumUsd: 360_000, tsMs: T0 })); // all at one instant
  const sustained = Array.from({ length: 15 }, (_, i) => p({ premiumUsd: 360_000, tsMs: T0 + i * 90_000 }));
  assert.ok(computeFlowQuality(sustained).components.persistence > computeFlowQuality(burst).components.persistence);
});

test("concentration: one strike beats premium smeared across many strikes", () => {
  const oneStrike = Array.from({ length: 12 }, (_, i) => p({ strike: 100, tsMs: T0 + i * 60_000 }));
  const spread = Array.from({ length: 12 }, (_, i) => p({ strike: 90 + i, tsMs: T0 + i * 60_000 }));
  assert.ok(computeFlowQuality(oneStrike).components.concentration > computeFlowQuality(spread).components.concentration);
});

test("sweepIntensity rewards sweep-heavy urgency over passive fills", () => {
  const swept = Array.from({ length: 10 }, (_, i) => p({ isSweep: true, tsMs: T0 + i * 60_000 }));
  const passive = Array.from({ length: 10 }, (_, i) => p({ isSweep: false, tsMs: T0 + i * 60_000 }));
  assert.ok(computeFlowQuality(swept).components.sweepIntensity > computeFlowQuality(passive).components.sweepIntensity);
});

test("direction: put-dominant tape reports SHORT-side dominance", () => {
  const rows = [
    ...Array.from({ length: 8 }, (_, i) => p({ side: "put", askPct: 75, premiumUsd: 400_000, tsMs: T0 + i * 60_000 })),
    ...Array.from({ length: 2 }, (_, i) => p({ side: "call", askPct: 50, premiumUsd: 100_000, tsMs: T0 + i * 60_000 })),
  ];
  const q = computeFlowQuality(rows);
  assert.equal(q.dominantSide, "put");
  assert.ok(q.dominance > 0.8);
});

test("institutional: block-size prints lift the institutional component", () => {
  const blocks = Array.from({ length: 6 }, (_, i) => p({ premiumUsd: 800_000, tsMs: T0 + i * 60_000 }));
  const retail = Array.from({ length: 6 }, (_, i) => p({ premiumUsd: 60_000, tsMs: T0 + i * 60_000 }));
  assert.ok(computeFlowQuality(blocks).components.institutional > computeFlowQuality(retail).components.institutional);
});

test("score is always clamped to 0..100 and components sum to it", () => {
  const q = computeFlowQuality(strongTape());
  const sum = Object.values(q.components).reduce((s, v) => s + v, 0);
  assert.ok(q.score >= 0 && q.score <= 100);
  assert.equal(q.score, Math.round(sum));
});
