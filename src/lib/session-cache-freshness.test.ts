import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync("src/lib/session-cache.ts", "utf8");

test("session-cache: TTL rejects clock-skewed future at stamps", () => {
  assert.match(src, /import \{ isWsUpdatedAtFresh \} from "@\/lib\/ws\/timestamp-freshness"/);
  assert.match(src, /isWsUpdatedAtFresh\(parsed\.at, maxAgeMs\)/);
  assert.doesNotMatch(src, /Date\.now\(\)\s*-\s*parsed\.at\s*>/);
});
