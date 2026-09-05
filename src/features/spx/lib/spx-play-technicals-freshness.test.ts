import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync("src/features/spx/lib/spx-play-technicals.ts", "utf8");

test("spx-play-technicals: playbook cache rejects future at stamps", () => {
  assert.match(src, /import \{ isWsUpdatedAtFresh \} from "@\/lib\/ws\/timestamp-freshness"/);
  assert.match(src, /isWsUpdatedAtFresh\(cached\.at, cacheMs, now\)/);
  assert.doesNotMatch(src, /now - cached\.at < cacheMs/);
});
