import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveNodeCount,
  parseNodeDensity,
  nodeDensityLabel,
  VECTOR_NODE_DENSITY_OPTIONS,
  VECTOR_DEFAULT_NODE_DENSITY,
} from "./vector-node-density";
import { VECTOR_WALL_NODES_PER_SIDE, wallCountForTimeframe } from "./vector-bar-timeframes";

test("AUTO defers to the timeframe heuristic, unchanged", () => {
  for (const tf of [1, 3, 5, 15, 30, 60, 120, 240] as const) {
    const auto = wallCountForTimeframe(tf);
    assert.equal(resolveNodeCount("auto", auto), auto, `tf=${tf}`);
  }
});

test("a manual pick overrides the timeframe heuristic in both directions", () => {
  // 1m auto is 6 — asking for 20 must widen it.
  assert.equal(resolveNodeCount(20, wallCountForTimeframe(1)), 20);
  // 4h auto is 20 — asking for 6 must narrow it.
  assert.equal(resolveNodeCount(6, wallCountForTimeframe(240)), 6);
});

test("no setting can exceed the recorder's per-side cap", () => {
  for (const d of VECTOR_NODE_DENSITY_OPTIONS) {
    assert.ok(
      resolveNodeCount(d, 20) <= VECTOR_WALL_NODES_PER_SIDE,
      `${d} exceeded the ${VECTOR_WALL_NODES_PER_SIDE} cap`
    );
  }
  // Even a hand-forged value out of range is clamped rather than trusted.
  assert.equal(resolveNodeCount(999 as never, 12), VECTOR_WALL_NODES_PER_SIDE);
});

test("a garbage auto count still yields a drawable rail", () => {
  for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
    const n = resolveNodeCount("auto", bad as number);
    assert.ok(n >= 1 && n <= VECTOR_WALL_NODES_PER_SIDE, `auto=${bad} -> ${n}`);
  }
});

test("parseNodeDensity narrows only supported values", () => {
  assert.equal(parseNodeDensity("auto"), "auto");
  assert.equal(parseNodeDensity("12"), 12);
  assert.equal(parseNodeDensity(16), 16);
  // 10 is deliberately NOT a step (the supply ladder is 6/8/12/16/20).
  assert.equal(parseNodeDensity("10"), null);
  assert.equal(parseNodeDensity("40"), null);
  assert.equal(parseNodeDensity(""), null);
  assert.equal(parseNodeDensity(null), null);
  assert.equal(parseNodeDensity({}), null);
});

test("AUTO label reports the count it resolved to", () => {
  assert.equal(nodeDensityLabel("auto", 6), "AUTO 6");
  assert.equal(nodeDensityLabel("auto", 20), "AUTO 20");
  assert.equal(nodeDensityLabel(12, 6), "12");
});

test("default is AUTO, so the shipped chart is unchanged until a member picks", () => {
  assert.equal(VECTOR_DEFAULT_NODE_DENSITY, "auto");
  assert.equal(VECTOR_NODE_DENSITY_OPTIONS[0], "auto");
});
