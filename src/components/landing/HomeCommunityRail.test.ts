import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SOURCE = readFileSync(join(__dirname, "HomeCommunityRail.tsx"), "utf8");

test("HomeCommunityRail links Discord invite with Join free label", () => {
  assert.match(SOURCE, /SITE\.social\.discord\.url/);
  assert.match(SOURCE, /label="Join free"/);
  assert.doesNotMatch(SOURCE, /\$75|Community Discord tier|paid membership|MEMBERSHIP_PRICING/i);
});

test("HomeCommunityRail links X and Whop store with logos", () => {
  assert.match(SOURCE, /SITE\.social\.x\.url/);
  assert.match(SOURCE, /WHOP_CHECKOUT\.store/);
  assert.match(SOURCE, /ICON_DISCORD/);
  assert.match(SOURCE, /ICON_WHOP/);
  assert.match(SOURCE, /ICON_X/);
  assert.doesNotMatch(SOURCE, /community-card|community-grid|community-head/i);
});
