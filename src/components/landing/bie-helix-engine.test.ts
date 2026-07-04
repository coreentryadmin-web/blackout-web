import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildHelixRungs,
  buildMeshWires,
  buildStarField,
  captureParticlePath,
  ellipsePath,
  placeSatellite,
  placeSatellites,
  ringRadii,
  type Satellite,
} from "./bie-helix-engine";

const CX = 480;
const CY = 210;
const MAX_RX = 248;
const MAX_RY = 118;

const SAMPLE: Satellite[] = [
  { id: "a", label: "A", detail: "d", angleDeg: 0, ring: 0, accent: "#fff" },
  { id: "b", label: "B", detail: "d", angleDeg: 120, ring: 0, accent: "#fff" },
  { id: "out", label: "Out", detail: "d", angleDeg: 240, ring: 2, accent: "#ffcc4d" },
];

describe("ringRadii", () => {
  it("scales outer ring larger than inner", () => {
    const inner = ringRadii(0, MAX_RX, MAX_RY);
    const outer = ringRadii(2, MAX_RX, MAX_RY);
    assert.ok(outer.rx > inner.rx);
    assert.ok(outer.ry > inner.ry);
  });
});

describe("placeSatellite", () => {
  it("places node on the correct ring ellipse", () => {
    const sat = placeSatellite(CX, CY, SAMPLE[0], MAX_RX, MAX_RY);
    const { rx, ry } = ringRadii(0, MAX_RX, MAX_RY);
    const dist = Math.hypot(sat.x - CX, sat.y - CY);
    const expected = Math.hypot(rx * Math.cos(0), ry * Math.sin(0));
    assert.ok(Math.abs(dist - Math.abs(expected)) < 2 || Math.abs(dist - ry) < 2);
  });
});

describe("buildMeshWires", () => {
  it("includes spokes, ring links, and feedback loop for outputs", () => {
    const placed = placeSatellites(CX, CY, SAMPLE, MAX_RX, MAX_RY);
    const wires = buildMeshWires(CX, CY, placed, "out");
    assert.ok(wires.some((w) => w.kind === "spoke"));
    assert.ok(wires.some((w) => w.kind === "ring"));
    assert.ok(wires.some((w) => w.id === "feedback-loop"));
  });
});

describe("buildHelixRungs", () => {
  it("returns count rungs with depth in 0..1", () => {
    const rungs = buildHelixRungs(CX, CY, 120, 60, 8, 0);
    assert.equal(rungs.length, 8);
    for (const r of rungs) {
      assert.ok(r.depth >= 0 && r.depth <= 1);
      assert.ok(Number.isFinite(r.x1) && Number.isFinite(r.y1));
    }
  });
});

describe("ellipsePath", () => {
  it("starts at leftmost point of ellipse", () => {
    const d = ellipsePath(CX, CY, 100, 50);
    assert.match(d, new RegExp(`M ${CX - 100} ${CY}`));
  });
});

describe("buildStarField", () => {
  it("returns deterministic star count", () => {
    const a = buildStarField(CX, CY, MAX_RX, MAX_RY, 40);
    const b = buildStarField(CX, CY, MAX_RX, MAX_RY, 40);
    assert.equal(a.length, 40);
    assert.deepEqual(a, b);
  });
});

describe("captureParticlePath", () => {
  it("passes through core coordinates in path", () => {
    const d = captureParticlePath(CX, CY, 45, MAX_RX, MAX_RY, 200);
    assert.match(d, new RegExp(`${CX} ${CY}`));
  });
});
