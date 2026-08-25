import assert from "node:assert/strict";
import test from "node:test";
import { composeCreativePack, buildCreativeCopy, FAMILY_COMBOS } from "./x-social-creative.mjs";

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

test("buildCreativeCopy includes live numbers and panel list", () => {
  const pack = composeCreativePack("META");
  const copy = buildCreativeCopy(
    {
      ticker: "META",
      spot: 560.2,
      netGex: -1.2e9,
      callWall: 580,
      putWall: 540,
      top: { premium: 2.1e6, option_type: "call", strike: 565 },
    },
    pack,
  );
  assert.ok(copy.includes("$META"), copy);
  assert.ok(copy.includes("①"), copy);
  assert.ok(copy.includes("$2.10M") || copy.includes("$2.1M"), copy);
});
