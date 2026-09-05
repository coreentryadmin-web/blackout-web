import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync("src/lib/clerk-user-cache.ts", "utf8");

test("clerk-user-cache: dedupe TTL uses isWsUpdatedAtFresh (rejects future at)", () => {
  assert.match(src, /import \{ isWsUpdatedAtFresh \} from "@\/lib\/ws\/timestamp-freshness"/);
  assert.match(src, /isWsUpdatedAtFresh\(hit\.at, DEDUPE_TTL_MS\)/);
  assert.doesNotMatch(src, /Date\.now\(\)\s*-\s*hit\.at\s*</);
});

test("clerk-user-cache: eviction sweep also uses isWsUpdatedAtFresh (rejects future at)", () => {
  // setResolved's size-pressure sweep is a second, independent call site with the
  // same raw-arithmetic bug: a far-future v.at never satisfies `now - v.at >= TTL`,
  // so a corrupted/clock-skewed entry is never swept (only evicted incidentally
  // once MAX_RESOLVED forces oldest-key deletion).
  assert.match(src, /isWsUpdatedAtFresh\(v\.at, DEDUPE_TTL_MS, now\)/);
  assert.doesNotMatch(src, /now\s*-\s*v\.at\s*>=\s*DEDUPE_TTL_MS/);
});
