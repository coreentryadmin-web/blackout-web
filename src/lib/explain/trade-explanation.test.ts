import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildTradeExplanation,
  factorsFromFlowQuality,
  factorsFromComponents,
} from "./trade-explanation.ts";

test("factors sort by magnitude, dominant reason first; net points sum", () => {
  const e = buildTradeExplanation({
    verdict: "COMMIT",
    factors: [
      { label: "VWAP Alignment", points: 9 },
      { label: "Flow Quality", points: 18 },
      { label: "Sweep Persistence", points: 12 },
    ],
  });
  assert.deepEqual(e.factors.map((f) => f.label), ["Flow Quality", "Sweep Persistence", "VWAP Alignment"]);
  assert.equal(e.netPoints, 39);
  assert.match(e.headline, /^COMMIT — Flow Quality \+18, Sweep Persistence \+12, VWAP Alignment \+9$/);
});

test("headline appends EV in R when the store can price it", () => {
  const e = buildTradeExplanation({ verdict: "COMMIT", factors: [{ label: "Flow Quality", points: 18 }], evR: 0.62 });
  assert.match(e.headline, /· EV \+0\.62R$/);
  assert.equal(e.evR, 0.62);
});

test("zero / non-finite factors are dropped (a component that argued nothing isn't a reason)", () => {
  const e = buildTradeExplanation({
    verdict: "WATCH",
    factors: [{ label: "A", points: 0 }, { label: "B", points: NaN }, { label: "C", points: 5 }],
  });
  assert.deepEqual(e.factors.map((f) => f.label), ["C"]);
});

test("negative factors are kept and can lead (a big drag is a top reason too)", () => {
  const e = buildTradeExplanation({
    verdict: "WATCH",
    factors: [{ label: "Conflict Penalty", points: -14 }, { label: "Flow Quality", points: 10 }],
  });
  assert.equal(e.factors[0]!.label, "Conflict Penalty");
  assert.equal(e.netPoints, -4);
});

test("gates, regime+confidence, liquidity, EV, and allocation all render into the lines block", () => {
  const e = buildTradeExplanation({
    verdict: "COMMIT",
    factors: [{ label: "Flow Quality", points: 18 }],
    gates: [{ label: "Cross-system", passed: true }, { label: "VIX regime", passed: false, detail: "elevated IV" }],
    regime: { label: "trend up · elevated-iv", confidence: 0.91 },
    liquidity: "A",
    evR: 0.62,
    allocation: { role: "PRIMARY", sizing: "FULL", reasons: ["rank #1 of 8 · primary SEMIS|LONG"] },
  });
  const blob = e.lines.join("\n");
  assert.match(blob, /COMMIT because/);
  assert.match(blob, /Flow Quality\s+\+18/);
  assert.match(blob, /Cross-system\s+✓ gate/);
  assert.match(blob, /VIX regime\s+✗ elevated IV/);
  assert.match(blob, /Regime\s+trend up · elevated-iv \(91%\)/);
  assert.match(blob, /Liquidity\s+A/);
  assert.match(blob, /Expected Value\s+\+0\.62R/);
  assert.match(blob, /Allocation\s+PRIMARY · FULL \(rank #1 of 8/);
});

test("factorsFromFlowQuality maps component keys to readable labels, drops zeros", () => {
  const factors = factorsFromFlowQuality({
    premiumDepth: 18, aggression: 12, sweepIntensity: 0, persistence: 9, concentration: 0, momentum: 6, institutional: 0,
  });
  const labels = factors.map((f) => f.label);
  assert.ok(labels.includes("Premium Depth"));
  assert.ok(labels.includes("Sweep Persistence"));
  assert.ok(!labels.includes("Sweep Intensity")); // was 0 → dropped
  assert.equal(factors.length, 4);
});

test("factorsFromComponents falls back to raw keys when no label map given", () => {
  const factors = factorsFromComponents({ momentum: 30, accumulation: 0, trendStack: 25 });
  assert.deepEqual(factors.map((f) => [f.label, f.points]).sort(), [["momentum", 30], ["trendStack", 25]].sort());
});

test("end-to-end from a real flow-quality shape", () => {
  const e = buildTradeExplanation({
    verdict: "COMMIT",
    factors: factorsFromFlowQuality({ premiumDepth: 20, aggression: 18, sweepIntensity: 16, persistence: 12, concentration: 10, momentum: 8, institutional: 4 }),
    evR: 0.5,
  });
  assert.equal(e.factors[0]!.label, "Premium Depth"); // biggest lever leads
  assert.equal(e.netPoints, 88);
  assert.equal(e.verdict, "COMMIT");
});
