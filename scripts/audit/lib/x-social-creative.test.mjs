import assert from "node:assert/strict";
import test from "node:test";
import { composeCreativePack, FAMILY_COMBOS } from "./x-social-creative.mjs";

test("composeCreativePack returns 4 shots from different families", () => {
  const pack = composeCreativePack("NVDA");
  assert.equal(pack.shots.length, 4);
  const products = new Set(pack.shots.map((s) => s.product));
  assert.ok(products.size >= 3, `expected diverse products, got ${[...products].join(",")}`);
  assert.ok(pack.label.length > 20);
});

test("composeCreativePack rotates combos", () => {
  const a = composeCreativePack("TSLA");
  const b = composeCreativePack("TSLA");
  assert.ok(FAMILY_COMBOS.some((c) => c.join("+") === a.combo.join("+")));
  assert.ok(FAMILY_COMBOS.some((c) => c.join("+") === b.combo.join("+")));
});
