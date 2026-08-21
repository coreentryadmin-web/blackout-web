import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

test("MeridianDesk syncs desk URL via App Router, not raw history.pushState/replaceState", () => {
  const src = readFileSync(join(root, "src/features/meridian/components/MeridianDesk.tsx"), "utf8");
  assert.match(src, /useRouter\(\)/);
  assert.match(src, /router\.push\(/);
  assert.match(src, /router\.replace\(/);
  assert.doesNotMatch(src, /history\.pushState/);
  assert.doesNotMatch(src, /history\.replaceState/);
});
