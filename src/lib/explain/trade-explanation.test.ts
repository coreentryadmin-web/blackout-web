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

test("fmtPts (via headline/lines) rounds exact-half ties symmetrically by magnitude, not by raw-value sign", () => {
  // Math.round() ties toward +Infinity, so a raw-value sign check (`n >= 0 ? "+" : ""`)
  // combined with `Math.round(n * 10) / 10` understates — or outright drops — the sign and
  // magnitude of a negative factor sitting exactly on a rounding tie relative to its positive
  // mirror image. -0.25 should render "-0.3" (same magnitude as +0.25 → "+0.3"), not "-0.2".
  const positive = buildTradeExplanation({ verdict: "COMMIT", factors: [{ label: "A", points: 0.25 }] });
  const negative = buildTradeExplanation({ verdict: "WATCH", factors: [{ label: "A", points: -0.25 }] });
  assert.match(positive.headline, /A \+0\.3$/);
  assert.match(negative.headline, /A -0\.3$/);

  // -0.05 is an even sharper case: Math.round(-0.05 * 10) / 10 === -0, which `n >= 0 ? "+" : ""`
  // (false for -0.05) combined with String(-0) === "0" renders as the bare string "0" — a
  // negative factor reading as an indistinguishable flat zero instead of "-0.1".
  const tinyNegative = buildTradeExplanation({ verdict: "WATCH", factors: [{ label: "B", points: -0.05 }] });
  assert.match(tinyNegative.headline, /B -0\.1$/);
});

test("fmtR (EV line) rounds exact-half ties symmetrically by magnitude, not by raw-value sign", () => {
  const positive = buildTradeExplanation({ verdict: "COMMIT", factors: [{ label: "A", points: 1 }], evR: 0.005 });
  const negative = buildTradeExplanation({ verdict: "WATCH", factors: [{ label: "A", points: 1 }], evR: -0.005 });
  assert.match(positive.headline, /EV \+0\.01R$/);
  assert.match(negative.headline, /EV -0\.01R$/);
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
