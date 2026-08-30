import assert from "node:assert/strict";
import test from "node:test";
import {
  assemblePost,
  nextPanelPack,
  PANEL_PACKS,
  POST_CHAR_LIMIT,
  PROMO_LINE,
  xWeightedLength,
} from "./x-social-post-kit.mjs";

test("xWeightedLength counts URLs as 23 chars", () => {
  const url = "https://whop.com/joined/blackout-2d9c/?utm_source=x";
  const text = `hello ${url}`;
  assert.equal(xWeightedLength(text), "hello ".length + 23);
});

test("assemblePost always includes BLACK50 and Whop", () => {
  const out = assemblePost("$NVDA 123 · test post\n\nFour panels ↓", "test-slug", { whopHook: "Join →" });
  assert.ok(out.includes("BLACK50"), out);
  assert.ok(out.includes("whop.com/joined/blackout"), out);
  assert.ok(out.includes(PROMO_LINE), out);
  assert.ok(xWeightedLength(out) <= POST_CHAR_LIMIT, `len=${xWeightedLength(out)}`);
});

test("nextPanelPack rotates across packs", () => {
  const a = nextPanelPack();
  const b = nextPanelPack();
  assert.ok(PANEL_PACKS.some((p) => p.slug === a.slug));
  assert.ok(PANEL_PACKS.some((p) => p.slug === b.slug));
});
