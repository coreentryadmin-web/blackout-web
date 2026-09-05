import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = readFileSync(join(import.meta.dirname, "..", "scripts", "validate-deploy.mjs"), "utf8");

test("validate-deploy skips ?force=1 cache warm outside extended warm hours", () => {
  assert.match(src, /import\s*\{\s*isEtExtendedWarmHours\s*\}\s*from\s*"\.\/gha-et-window\.mjs"/);
  const anchor = src.indexOf("2b. Cache warmers");
  assert.ok(anchor >= 0, "cache warmers section must exist");
  const block = src.slice(anchor, anchor + 1200);
  assert.match(block, /if\s*\(\s*!isEtExtendedWarmHours\(\)\s*\)/);
  assert.match(block, /skipping post-deploy cache warm/);
});
