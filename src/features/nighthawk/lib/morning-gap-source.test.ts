import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveLiveIndexPrice } from "./morning-gap-source";

test("resolveLiveIndexPrice: returns the price when it differs from prev_close (a real live print)", () => {
  assert.equal(resolveLiveIndexPrice({ price: 7786.36, prev_close: 7765.57 }), 7786.36);
});

test("resolveLiveIndexPrice: returns null when price === prev_close (the fetchIndexSnapshots fallback collision)", () => {
  assert.equal(resolveLiveIndexPrice({ price: 7765.57, prev_close: 7765.57 }), null);
});

test("resolveLiveIndexPrice: returns the price as-is when prev_close is unknown (can't detect the collision)", () => {
  assert.equal(resolveLiveIndexPrice({ price: 7786.36, prev_close: null }), 7786.36);
});

test("resolveLiveIndexPrice: returns null for a null/undefined quote", () => {
  assert.equal(resolveLiveIndexPrice(null), null);
  assert.equal(resolveLiveIndexPrice(undefined), null);
});
