import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PIVOT_PICK_COMMIT_EPS,
  effectivePickBias,
  pivotPickWaitingCopy,
} from "./vector-pick-effective-bias";
import type { VectorPlay } from "./vector-play-engine";

function pivotPlay(): VectorPlay {
  return {
    style: "scalp",
    bias: "neutral",
    setup: "pivot",
    conviction: 65,
    grade: "B",
    headline: "SCALP · pivot at the 352.56 gamma flip",
    thesis: "test",
    targets: [],
    starred: [],
  };
}

test("effectivePickBias: pivot ranks long once spot clears flip", () => {
  const play = pivotPlay();
  assert.equal(effectivePickBias(play, 353, 352.56), "long");
  assert.equal(effectivePickBias(play, 352, 352.56), "short");
  assert.equal(effectivePickBias(play, 352.56, 352.56), null);
  const near = 352.56 * (1 + PIVOT_PICK_COMMIT_EPS * 0.5);
  assert.equal(effectivePickBias(play, near, 352.56), null);
});

test("effectivePickBias: non-pivot neutral returns null", () => {
  const play = { ...pivotPlay(), setup: "stand-aside" as const };
  assert.equal(effectivePickBias(play, 360, 352), null);
});

test("pivotPickWaitingCopy: explains why PLYS is empty at the flip", () => {
  const msg = pivotPickWaitingCopy(pivotPlay(), 352.56);
  assert.match(msg ?? "", /commits above or below/i);
});
