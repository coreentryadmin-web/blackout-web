import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync("src/features/spx/lib/spx-play-claude.ts", "utf8");

test("spx-play-claude: cache TTL uses isWsUpdatedAtFresh (rejects future at)", () => {
  assert.match(src, /import \{ isWsUpdatedAtFresh \} from "@\/lib\/ws\/timestamp-freshness"/);
  assert.match(src, /isWsUpdatedAtFresh\(mem\.at, cacheTtlMs\)/);
  assert.match(src, /isWsUpdatedAtFresh\(slot\.at, cacheTtlMs\)/);
  assert.doesNotMatch(src, /Date\.now\(\)\s*-\s*mem\.at/);
  assert.doesNotMatch(src, /Date\.now\(\)\s*-\s*slot\.at/);
});
