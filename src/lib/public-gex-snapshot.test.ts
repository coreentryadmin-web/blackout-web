import assert from "node:assert/strict";
import { test } from "node:test";
import { isPublicGexTicker, publicGexTickers } from "./public-gex-snapshot.ts";

test("isPublicGexTicker accepts only the 3-ticker allowlist", () => {
  assert.equal(isPublicGexTicker("SPX"), true);
  assert.equal(isPublicGexTicker("SPY"), true);
  assert.equal(isPublicGexTicker("QQQ"), true);
});

test("isPublicGexTicker rejects anything outside the allowlist", () => {
  // Guards the public route's abuse surface — an arbitrary ticker must never
  // reach fetchGexHeatmap() from an unauthenticated caller.
  assert.equal(isPublicGexTicker("NVDA"), false);
  assert.equal(isPublicGexTicker(""), false);
  assert.equal(isPublicGexTicker("spx"), false, "case-sensitive — route uppercases before checking");
});

test("publicGexTickers matches the allowlist isPublicGexTicker checks against", () => {
  const list = publicGexTickers();
  assert.deepEqual([...list], ["SPX", "SPY", "QQQ"]);
  for (const t of list) assert.equal(isPublicGexTicker(t), true);
});
