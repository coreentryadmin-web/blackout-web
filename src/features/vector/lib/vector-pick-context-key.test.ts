import { test } from "node:test";
import assert from "node:assert/strict";
import {
  vectorContractPickFetchKey,
  vectorPickArchiveResetKey,
} from "./vector-pick-context-key";
import type { VectorPlayEmit } from "./vector-play-engine";

const baseEmit: VectorPlayEmit = {
  spot: 100,
  callWall: 105,
  putWall: 95,
  play: {
    bias: "long",
    conviction: "high",
    headline: "Test play",
    grade: "A",
    thesis: "test",
    invalidation: "below 99",
    style: "momentum",
  },
};

test("vectorPickArchiveResetKey ignores spot ticks", () => {
  const a = vectorPickArchiveResetKey(baseEmit, 3, "long");
  const bumped = { ...baseEmit, spot: 100.47 };
  const b = vectorPickArchiveResetKey(bumped, 3, "long");
  assert.equal(a, b);
});

test("vectorPickArchiveResetKey changes when walls or play change", () => {
  const a = vectorPickArchiveResetKey(baseEmit, 3, "long");
  assert.notEqual(a, vectorPickArchiveResetKey({ ...baseEmit, callWall: 106 }, 3, "long"));
  assert.notEqual(
    a,
    vectorPickArchiveResetKey(
      { ...baseEmit, play: { ...baseEmit.play!, headline: "Other" } },
      3,
      "long"
    )
  );
});

test("vectorContractPickFetchKey includes excludeOccs", () => {
  const a = vectorContractPickFetchKey(baseEmit, 0, []);
  const b = vectorContractPickFetchKey(baseEmit, 0, ["OCC1"]);
  assert.notEqual(a, b);
  assert.ok(b.endsWith("|OCC1"));
});
