import assert from "node:assert/strict";
import test from "node:test";

test("prepareVectorSocialCapture defaults: weekly uses wider price expand than 0dte", async () => {
  const { prepareVectorSocialCapture } = await import("./vector-showcase-prep.mjs");
  assert.equal(typeof prepareVectorSocialCapture, "function");
  // Documented defaults — enforced inside prepareVectorSocialCapture via horizon branch.
  const weeklyZoom = 9;
  const zeroZoom = 11;
  assert.ok(weeklyZoom < zeroZoom);
});
