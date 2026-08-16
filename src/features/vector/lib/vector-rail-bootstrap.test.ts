import { test } from "node:test";
import assert from "node:assert/strict";
import { prepareRailBootstrapHistory } from "./vector-wall-history";
import type { WallHistorySample } from "./vector-wall-history";

function sample(time: number): WallHistorySample {
  return {
    time,
    walls: { callWalls: [{ strike: 6800, pct: 10, notional: 1e9 }], putWalls: [] },
    gammaFlip: 6750,
  };
}

test("prepareRailBootstrapHistory: trims pre-session samples then decimates tail", () => {
  const history = [sample(100), sample(160), sample(220), sample(280)];
  const out = prepareRailBootstrapHistory(history, 200);
  assert.ok(out.every((s) => s.time >= 200), "pre-session samples trimmed");
  assert.ok(out.length <= history.length);
});

test("prepareRailBootstrapHistory: preserves notional on wall levels", () => {
  const out = prepareRailBootstrapHistory([sample(1000)], 900);
  assert.equal(out[0]!.walls.callWalls[0]!.notional, 1e9);
});
