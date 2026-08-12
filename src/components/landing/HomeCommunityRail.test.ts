import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SOURCE = readFileSync(join(__dirname, "HomeCommunityRail.tsx"), "utf8");

test("HomeCommunityRail is Discord-only with Join free label", () => {
  assert.match(SOURCE, /SITE\.social\.discord\.url/);
  assert.match(SOURCE, />Join free</);
  assert.doesNotMatch(SOURCE, /WHOP_CHECKOUT|SITE\.social\.x|ICON_WHOP|ICON_X/i);
  assert.doesNotMatch(SOURCE, /\$75|Community Discord tier|paid membership|MEMBERSHIP_PRICING/i);
});
