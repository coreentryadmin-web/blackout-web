import assert from "node:assert/strict";
import test from "node:test";
import { buildKingNodeCopy, composeKingNodePack } from "./x-social-story-data.mjs";

test("composeKingNodePack includes Vector weekly with bead wait", () => {
  const pack = composeKingNodePack({
    ticker: "NVDA",
    horizon: "weekly",
    spot: 208.9,
    kingStrike: 215,
    kingGamma: 120_000_000,
    distPct: 2.9,
  });
  assert.equal(pack.storyKind, "king");
  assert.equal(pack.shots[0].params.wait_beads, true);
  assert.equal(pack.shots[0].params.horizon, "weekly");
});

test("buildKingNodeCopy mentions king strike and gamma", () => {
  const copy = buildKingNodeCopy({
    ticker: "TSLA",
    spot: 340.5,
    kingStrike: 350,
    kingGamma: 85_000_000,
    horizon: "weekly",
    distPct: 2.8,
  });
  assert.ok(copy.includes("$TSLA"), copy);
  assert.ok(copy.includes("350"), copy);
  assert.ok(copy.includes("king node"), copy.toLowerCase());
});
