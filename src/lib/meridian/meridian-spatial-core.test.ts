import { test } from "node:test";
import assert from "node:assert/strict";
import { project, orbitalLayout, orbitalPoint, tiltFromPointer, ringStack } from "./meridian-spatial-core";

const SIGNALS = [
  { pillar: "flow", label: "Flow", lean: "bullish", weight: 4, score: 12 },
  { pillar: "dark_pool", label: "Dark pool", lean: "bullish", weight: 1, score: 3 },
  { pillar: "thermal", label: "Gamma", lean: "bearish", weight: 2, score: -6 },
  { pillar: "analyst", label: "Street", lean: "bearish", weight: 3, score: -9 },
  { pillar: "history", label: "Record", lean: "bullish", weight: 2, score: 6 },
];

// ── projection
test("project: zero tilt is the identity in x/y", () => {
  const p = project({ x: 0.5, y: -0.25, z: 0 }, 0, 0);
  assert.equal(p.x, 0.5);
  assert.equal(p.y, -0.25);
  assert.equal(p.scale, 1, "no perspective scaling on the z=0 plane");
});

test("project: depth ordering survives a tilt — the near point stays nearer", () => {
  const near = project({ x: 0, y: -1, z: 0 }, 20, 0);
  const far = project({ x: 0, y: 1, z: 0 }, 20, 0);
  assert.ok(near.depth !== far.depth, "a tilt must actually separate the two edges");
  assert.ok(near.scale !== far.scale, "and size must follow depth, or it will not read as tilted");
});

test("project: perspective is mild — radius encodes influence and must stay readable", () => {
  // Across a full unit disc under the maximum tilt the layer allows, the near/far size ratio
  // must stay modest. A strong lens would make an outer-orbit pillar on the near side look
  // closer to centre than an inner one on the far side, inverting the encoding.
  const near = project({ x: 0, y: -1, z: 0 }, 12, 0);
  const far = project({ x: 0, y: 1, z: 0 }, 12, 0);
  const ratio = near.scale / far.scale;
  assert.ok(ratio > 1 && ratio < 1.35, `expected a mild ratio, got ${ratio.toFixed(3)}`);
});

// ── orbital layout
test("orbitalLayout: heavier pillars sit CLOSER to the centre", () => {
  const nodes = orbitalLayout(SIGNALS);
  const flow = nodes.find((n) => n.pillar === "flow")!; // weight 4, the heaviest
  const dark = nodes.find((n) => n.pillar === "dark_pool")!; // weight 1, the lightest
  assert.ok(flow.radius < dark.radius, "influence must read as proximity to the answer");
  assert.equal(flow.radius, 0.34, "the heaviest pillar sits on the inner orbit");
  assert.equal(dark.radius, 1, "the lightest reaches the rim — the full range is used");
});

test("orbitalLayout: all-equal weights share one orbit rather than inventing a hierarchy", () => {
  const nodes = orbitalLayout([
    { pillar: "flow", lean: "bullish", weight: 2, score: 1 },
    { pillar: "thermal", lean: "bearish", weight: 2, score: 1 },
  ]);
  assert.equal(nodes[0]!.radius, nodes[1]!.radius);
  assert.ok(nodes[0]!.radius > 0.34 && nodes[0]!.radius < 1, "a mid orbit, not an extreme");
});

test("orbitalLayout: pillars of the same dimension are angular neighbours", () => {
  const nodes = orbitalLayout(SIGNALS);
  const flowDim = nodes.filter((n) => n.dimension === "FLOW").map((n) => n.angle).sort((a, b) => a - b);
  const others = nodes.filter((n) => n.dimension !== "FLOW").map((n) => n.angle);
  // No foreign pillar may fall between two members of the same dimension — that is what makes
  // angular proximity mean "related".
  const between = others.filter((a) => a > flowDim[0]! && a < flowDim[flowDim.length - 1]!);
  assert.deepEqual(between, [], "a sector must not be interleaved with another dimension");
});

test("orbitalLayout: sector width tracks pillar count — a 2-pillar dimension gets twice a 1's", () => {
  const nodes = orbitalLayout(SIGNALS);
  // FLOW has 2 of 5 pillars, SENTIMENT has 1 of 5.
  assert.equal(nodes.filter((n) => n.dimension === "FLOW").length, 2);
  assert.equal(nodes.filter((n) => n.dimension === "SENTIMENT").length, 1);
});

test("orbitalLayout: a lone pillar sits at its sector's midpoint, not on the boundary", () => {
  const nodes = orbitalLayout([
    { pillar: "flow", lean: "bullish", weight: 1, score: 1 },
    { pillar: "analyst", lean: "bearish", weight: 1, score: 1 },
  ]);
  // Two dimensions, 180° each; each lone member should be centred at 90° and 270°.
  const angles = nodes.map((n) => n.angle).sort((a, b) => a - b);
  assert.deepEqual(angles, [90, 270], "a boundary-hugging node reads as belonging to its neighbour");
});

test("orbitalLayout: size floors above zero so a zero-score pillar is still visible", () => {
  const nodes = orbitalLayout([{ pillar: "flow", lean: "neutral", weight: 1, score: 0 }]);
  assert.ok(nodes[0]!.size >= 0.18, "a present-but-neutral pillar must not vanish");
});

test("orbitalLayout: unknown pillars are dropped rather than placed arbitrarily", () => {
  assert.deepEqual(orbitalLayout([{ pillar: "invented", lean: "bullish", weight: 5 }]), []);
  assert.deepEqual(orbitalLayout([]), []);
  assert.deepEqual(orbitalLayout(null), []);
});

test("orbitalPoint: an untilted node lands on its own circle", () => {
  const nodes = orbitalLayout(SIGNALS);
  const n = nodes[0]!;
  const p = orbitalPoint(n, 0, 0);
  const r = Math.hypot(p.x, p.y);
  assert.ok(Math.abs(r - n.radius) < 1e-4, `expected radius ${n.radius}, got ${r}`);
});

// ── tilt
test("tiltFromPointer: centre is neutral and the surface leans toward the cursor", () => {
  assert.deepEqual(tiltFromPointer(0.5, 0.5), { x: 0, y: 0 });
  assert.ok(tiltFromPointer(1, 0.5).y > 0, "cursor right → rotateY positive");
  assert.ok(tiltFromPointer(0.5, 0).x > 0, "cursor up → leans toward it");
});

test("tiltFromPointer: capped, so distortion never becomes readable as data", () => {
  const extreme = tiltFromPointer(2, -2, 12);
  assert.ok(Math.abs(extreme.x) <= 12 && Math.abs(extreme.y) <= 12, "out-of-range pointer stays capped");
});

// ── ring stack
test("ringStack: three layers on separate planes — they are different questions", () => {
  const s = ringStack(0.7, "medium")!;
  assert.deepEqual(s.map((l) => l.key), ["pillars", "agreement", "confidence"]);
  assert.ok(s[0]!.z < s[1]!.z && s[1]!.z < s[2]!.z, "depth must separate them for the tilt to reveal");
  assert.ok(s[0]!.radius > s[1]!.radius && s[1]!.radius > s[2]!.radius, "and they must nest");
});

test("ringStack: an unlabelled confidence does not become a full core", () => {
  const s = ringStack(0.7, null)!;
  assert.deepEqual(s.map((l) => l.key), ["pillars", "agreement"]);
  const s2 = ringStack(0.7, "not-a-level")!;
  assert.equal(s2.length, 2, "an unrecognised level is absent, not maximal");
});

test("ringStack: unknown agreement → no stack (a missing middle would imply consensus)", () => {
  assert.equal(ringStack(null, "high"), null);
  assert.equal(ringStack(undefined, "high"), null);
});

test("ringStack: confidence maps to distinct, ordered fills", () => {
  const low = ringStack(1, "low")!.find((l) => l.key === "confidence")!.value;
  const med = ringStack(1, "medium")!.find((l) => l.key === "confidence")!.value;
  const high = ringStack(1, "high")!.find((l) => l.key === "confidence")!.value;
  assert.ok(low < med && med < high);
});
