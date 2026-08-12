import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SOURCE = readFileSync(join(__dirname, "RedesignHome.tsx"), "utf8");

test("RedesignHome links to the free gamma snapshot tool from hero, band, and academy", () => {
  const matches = SOURCE.match(/href="\/tools\/gamma-snapshot"/g) ?? [];
  assert.ok(matches.length >= 3, `expected ≥3 internal links to /tools/gamma-snapshot, got ${matches.length}`);
});
