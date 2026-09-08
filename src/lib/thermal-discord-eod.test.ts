import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const moduleSrc = readFileSync(fileURLToPath(new URL("./thermal-discord-eod.ts", import.meta.url)), "utf8");

// Regression for #3960 (CLQ-037/044): sharedCacheSetNx now THROWS on a Redis command error
// instead of silently falling back to an in-memory acquire — every caller must decide fail-open
// vs fail-closed explicitly. claimThermalEodRecap is a duplicate-post-tolerant dedup guard, so it
// must fail OPEN (post anyway) rather than let a transient Redis blip suppress the EOD recap.
test("claimThermalEodRecap fails OPEN on a sharedCacheSetNx rejection", () => {
  assert.match(
    moduleSrc,
    /return sharedCacheSetNx\(\s*thermalEodRecapDedupKey\(sessionDate\),[\s\S]{0,80}\)\.catch\(\s*\(\) => true\s*\)/,
    "claimThermalEodRecap must have an explicit .catch(() => true) now that Redis errors propagate"
  );
});
