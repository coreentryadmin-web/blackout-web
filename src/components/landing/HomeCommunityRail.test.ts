import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SOURCE = readFileSync(join(__dirname, "HomeCommunityRail.tsx"), "utf8");

test("HomeCommunityRail links Discord invite directly and marks it free", () => {
  assert.match(SOURCE, /SITE\.social\.discord\.url/);
  assert.match(SOURCE, /kicker="Free"\s*\n\s*title="Join the Discord"/);
  assert.doesNotMatch(SOURCE, /\$75|Community Discord tier|paid membership/i);
});

test("HomeCommunityRail links X and Whop store", () => {
  assert.match(SOURCE, /SITE\.social\.x\.url/);
  assert.match(SOURCE, /WHOP_CHECKOUT\.store/);
});
