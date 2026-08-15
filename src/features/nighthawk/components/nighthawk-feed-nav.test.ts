import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

test("NightHawkFeed syncs view URL via App Router replace, not raw history.replaceState", () => {
  const src = readFileSync(join(root, "src/features/nighthawk/components/NightHawkFeed.tsx"), "utf8");
  assert.match(src, /useRouter\(\)/);
  assert.match(src, /router\.replace\(/);
  assert.doesNotMatch(src, /history\.replaceState/);
});
