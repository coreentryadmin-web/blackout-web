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

// BUG FIX (round 253 DISCOVERY sweep): `effectivePickBias` only checked `flip == null` before
// dividing by it, while its sibling in this SAME file (`pivotPickWaitingCopy`, two lines down)
// already guards `gammaFlip != null && Number.isFinite(gammaFlip)` for the identical field. A
// non-finite flip (NaN survives `== null`, since NaN !== null) fell through the guard, produced
// `Math.abs(spot - NaN) / NaN === NaN`, failed the `dist < PIVOT_PICK_COMMIT_EPS` check (NaN is
// never `<` anything), and then `spot > NaN` evaluated false — so the function fabricated a
// confident "short" ranking bias from a genuinely unknown flip instead of returning null
// ("undetermined"), the same absence-as-measurement failure this lane has fixed repeatedly
// elsewhere (flow-gex-proximity.ts, helix-darkpool-bias.ts, etc).
test("effectivePickBias: non-finite flip is undetermined, never fabricated", () => {
  const play = pivotPlay();
  assert.equal(effectivePickBias(play, 353, NaN), null);
  assert.equal(effectivePickBias(play, 353, Infinity), null);
});

test("pivotPickWaitingCopy: explains why PLYS is empty at the flip", () => {
  const msg = pivotPickWaitingCopy(pivotPlay(), 352.56);
  assert.match(msg ?? "", /commits above or below/i);
});
