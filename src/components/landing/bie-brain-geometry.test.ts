import { test } from "node:test";
import assert from "node:assert/strict";
import { spokePath, meshPath } from "./bie-brain-geometry";

test("spokePath: starts at the core, ends at the node, uses a quadratic curve", () => {
  const d = spokePath(600, 60, 80, 220);
  assert.equal(d.startsWith("M600,60"), true);
  assert.match(d, /^M600,60 Q\d+(\.\d+)?,\d+(\.\d+)? 80,220$/);
});

test("spokePath: control point droops toward the node's y, not the core's", () => {
  const d = spokePath(600, 60, 80, 220);
  const [, cy] = d.match(/Q\d+(?:\.\d+)?,(\d+(?:\.\d+)?)/)!;
  // 0.55 of the way from y0=60 to y1=220 → 60 + 160*0.55 = 148, closer to the node than the core
  assert.equal(Number(cy), 60 + (220 - 60) * 0.55);
});

test("meshPath: starts and ends on the shared node y, arcs upward by `bow`", () => {
  const d = meshPath(80, 288, 220, 30);
  assert.equal(d, "M80,220 Q184,190 288,220");
});

test("meshPath: control point x is the midpoint of the two nodes", () => {
  const d = meshPath(0, 100, 50, 10);
  const [, cx] = d.match(/Q(\d+(?:\.\d+)?)/)!;
  assert.equal(Number(cx), 50);
});
