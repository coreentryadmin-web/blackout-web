import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SOURCE = readFileSync(join(__dirname, "HomeCommunityRail.tsx"), "utf8");

test("HomeCommunityRail does not claim Discord is free in member-facing copy", () => {
  assert.doesNotMatch(SOURCE, /Join Discord for free|Discord for free|free Discord/i);
  assert.match(SOURCE, /Discord access ships with a paid membership/i);
});

test("HomeCommunityRail links X, Whop store, and Discord checkout", () => {
  assert.match(SOURCE, /SITE\.social\.x\.url/);
  assert.match(SOURCE, /WHOP_CHECKOUT\.store/);
  assert.match(SOURCE, /WHOP_CHECKOUT\.community/);
});
