import { test } from "node:test";
import assert from "node:assert/strict";
import {
  project,
  orbitalLayout,
  orbitalPoint,
  orbitalGeometry,
  orbitalLabelOffset,
  ORBIT_INNER,
  MIN_ORBITAL_SIZE,
  tiltFromPointer,
  ringStack,
} from "./meridian-spatial-core";

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
  assert.equal(flow.radius, ORBIT_INNER, "the heaviest pillar sits on the inner orbit");
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

/* ── Label collision ────────────────────────────────────────────────────────────────
 * Regression guard for a defect found by LOOKING at the live render, not by any test:
 * on NKLR, "Latest print", "Fundamentals" and "Helix flow" printed on top of each other
 * over the core because every label hung directly below its own orb.
 *
 * This walks the SAME functions the component calls (orbitalGeometry / orbitalLabelOffset),
 * so it cannot pass while the rendered layout fails — a check that recomputes placement its
 * own way proves nothing about what ships.
 */
const ORBIT_PILLARS: ReadonlyArray<readonly [string, string]> = [
  ["flow", "Helix flow"], ["dark_pool", "Dark pool"], ["thermal", "Thermal"],
  ["vector", "Vector"], ["analyst", "Analyst"], ["news", "News"],
  ["insider", "Insider"], ["history", "Latest print"], ["surprise", "Surprise"],
  ["yoy", "Year on year"], ["fundamentals", "Fundamentals"],
];

// Two weight regimes, because they fail differently and production produces both: FLAT
// collapses every node onto one orbit, SPREAD pulls heavy pillars into the core (the NKLR
// shape, where a constant label offset stacked labels over the centre).
const WEIGHT_REGIMES: ReadonlyArray<readonly [string, (i: number) => number]> = [
  ["flat", (i) => 1 + (i % 2) * 0.02],
  ["spread", (i) => 0.2 + i * 0.55],
];

const CHAR_PX = 5.7; // 0.52rem mono advance — must track .ms-orb-label's font-size
const LINE_PX = 11;

function labelBoxes(size: number, weight: (i: number) => number) {
  const geo = orbitalGeometry(size);
  // The EFFECTIVE box, not the requested one — below MIN_ORBITAL_SIZE the geometry clamps, and
  // measuring against the request would report a clip the component never renders.
  const half = geo.size / 2;
  const signals = ORBIT_PILLARS.map(([pillar, label], i) => ({
    pillar, label, lean: i % 3 === 0 ? "bullish" : i % 3 === 1 ? "bearish" : "neutral",
    weight: weight(i), score: 0.4 + (i % 4) * 0.1, detail: "",
  }));
  return orbitalLayout(signals).map((n) => {
    const a = (n.angle * Math.PI) / 180;
    const { lx, ly, anchor } = orbitalLabelOffset(n, geo);
    const cx = half + Math.cos(a) * n.radius * geo.R + lx;
    const cy = half + Math.sin(a) * n.radius * geo.R + ly;
    const w = Math.min(geo.labelMaxW, n.label.length * CHAR_PX + 4);
    const shift = anchor === "0%" ? 0 : anchor === "-100%" ? -1 : -0.5;
    const x0 = cx + shift * w;
    return { label: n.label, x0, x1: x0 + w, y0: cy - LINE_PX / 2, y1: cy + LINE_PX / 2 };
  });
}

for (const [regime, weight] of WEIGHT_REGIMES) {
  for (const size of [260, 300, 340]) {
    test(`orbital labels: no overlap and none clipped — ${regime} weights @ ${size}px`, () => {
      const boxes = labelBoxes(size, weight);
      assert.ok(boxes.length >= 10, "fixture should exercise a full pillar book");
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i], b = boxes[j];
          const ox = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
          const oy = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
          // 1px of tolerance: sub-pixel touching is invisible, a real collision is not.
          assert.ok(ox <= 1 || oy <= 1, `"${a.label}" overlaps "${b.label}" by ${ox.toFixed(1)}x${oy.toFixed(1)}px`);
        }
      }
      const box = orbitalGeometry(size).size;
      for (const b of boxes) {
        assert.ok(b.x0 >= -2 && b.x1 <= box + 2, `"${b.label}" is clipped horizontally (${b.x0.toFixed(1)}..${b.x1.toFixed(1)} in ${box})`);
        assert.ok(b.y0 >= -2 && b.y1 <= box + 2, `"${b.label}" is clipped vertically`);
      }
    });
  }
}

/**
 * The innermost orbit must CLEAR the core mark.
 *
 * Regression guard for a live defect on AXIL: radius encodes INVERSE weight, so the heaviest
 * pillar sits innermost — and at ORBIT_INNER = 0.34 its orb painted straight over the centre.
 * The numbers below mirror the component and the stylesheet: orb diameter is `14 + size * 22`
 * (size ≤ 1), and `.ms-core-dot` is 12px.
 */
test("orbital: the innermost orb clears the core mark at every rendered size", () => {
  const MAX_ORB_R = (14 + 22) / 2;
  const CORE_R = 6;
  // 310 and 400 are the collapsed and expanded sizes the report panel actually renders.
  for (const size of [200, 260, 310, 340, 400]) {
    const geo = orbitalGeometry(size);
    const gap = ORBIT_INNER * geo.R - MAX_ORB_R - CORE_R;
    assert.ok(gap >= 0, `at ${size}px the innermost orb overlaps the core by ${(-gap).toFixed(1)}px`);
  }
});

test("orbitalGeometry: a label is never allowed to be wider than the room it has", () => {
  for (const size of [220, 260, 310, 340, 400, 520]) {
    const geo = orbitalGeometry(size);
    // Derived from the EFFECTIVE box, not the requested one — below the floor they differ.
    assert.equal(geo.labelMaxW, geo.size / 2 - geo.rimR, "labelMaxW must be derived, not assumed");
    assert.ok(geo.labelMaxW > 0, `no label room at ${size}px`);
    assert.ok(geo.R > 0, `no disc at ${size}px`);
    assert.ok(geo.size >= MIN_ORBITAL_SIZE, "the box never goes below the legibility floor");
  }
});
