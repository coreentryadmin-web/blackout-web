import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

test("marketing hash nav helper exists for homepage anchors", () => {
  const lib = readFileSync(join(root, "src/lib/marketing-hash-nav.ts"), "utf8");
  assert.match(lib, /handleMarketingHomeHashClick/);
  assert.match(lib, /scrollIntoView/);
  assert.match(lib, /history\.replaceState/);
});

test("hero explore CTA uses MarketingHashLink for #modules", () => {
  const home = readFileSync(join(root, "src/components/landing/RedesignHome.tsx"), "utf8");
  const link = readFileSync(join(root, "src/components/landing/MarketingHashLink.tsx"), "utf8");
  assert.match(home, /MarketingHashLink href="#modules"/);
  assert.match(link, /handleMarketingHomeHashClick/);
});
