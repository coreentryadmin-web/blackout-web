import assert from "node:assert/strict";
import test from "node:test";
import { vectorCrosshairStatesEqual } from "@/features/vector/lib/vector-crosshair-equality";

const base = {
  time: "10:30",
  close: 5800,
  lens: "gex" as const,
  flip: 5790,
  callWalls: [{ strike: 5810, pct: 80 }],
  putWalls: [{ strike: 5780, pct: 70 }],
  darkPoolLevels: [],
  gexCell: { strike: 5800, value: 1_000_000 },
};

test("vectorCrosshairStatesEqual: identical payloads", () => {
  assert.equal(vectorCrosshairStatesEqual(base, { ...base }), true);
});

test("vectorCrosshairStatesEqual: null transitions", () => {
  assert.equal(vectorCrosshairStatesEqual(null, null), true);
  assert.equal(vectorCrosshairStatesEqual(base, null), false);
  assert.equal(vectorCrosshairStatesEqual(null, base), false);
});

test("vectorCrosshairStatesEqual: wall drift", () => {
  assert.equal(
    vectorCrosshairStatesEqual(base, {
      ...base,
      callWalls: [{ strike: 5810, pct: 81 }],
    }),
    false
  );
});
