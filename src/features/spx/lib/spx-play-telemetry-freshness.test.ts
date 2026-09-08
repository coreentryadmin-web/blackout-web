import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync("src/features/spx/lib/spx-play-telemetry.ts", "utf8");

test("spx-play-telemetry: adaptive gates cache rejects future at stamps", () => {
  assert.match(src, /import \{ isWsUpdatedAtFresh \} from "@\/lib\/ws\/timestamp-freshness"/);
  assert.match(src, /isWsUpdatedAtFresh\(cached\.at, CACHE_MS, now\)/);
  assert.doesNotMatch(src, /now - cached\.at < CACHE_MS/);
});
