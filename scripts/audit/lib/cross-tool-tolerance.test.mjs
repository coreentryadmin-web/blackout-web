import { test } from "node:test";
import assert from "node:assert/strict";
import { spotAgreementTol, spotsAgree, flipsAgree } from "./cross-tool-tolerance.mjs";

test("spotAgreementTol: 1% of SPX spot with 1pt floor", () => {
  assert.equal(spotAgreementTol(7500), 75);
  assert.equal(spotAgreementTol(50), 1);
});

test("spotsAgree: sub-1% RTH parallel-fetch jitter passes", () => {
  assert.equal(spotsAgree(7530.24, 7526.46, 7528), true);
  assert.equal(spotsAgree(7529.19, 7530.26, 7530), true);
});

test("flipsAgree: matrix vs positioning flip within 1% band", () => {
  assert.equal(flipsAgree(7485.29, 7479.44, 7528), true);
  assert.equal(flipsAgree(7485.29, 7400, 7528), false);
});
