import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const routeSrc = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "route.ts"),
  "utf8"
);

// Regression for #3960 (CLQ-037/044): sharedCacheSetNx now THROWS on a Redis command error
// instead of silently falling back to an in-memory acquire — every caller must decide fail-open
// vs fail-closed explicitly. This 15-min dedup guard is duplicate-post-tolerant, so it must fail
// OPEN (post anyway) rather than let a transient Redis blip fail the whole scheduled-snapshot run.
test("thermal-discord scheduled-snapshot dedup fails OPEN on a sharedCacheSetNx rejection", () => {
  assert.match(
    routeSrc,
    /await sharedCacheSetNx\(\s*THERMAL_DISCORD_DEDUP_KEY,[\s\S]{0,150}\)\.catch\(\s*\(\) => true\s*\)/,
    "THERMAL_DISCORD_DEDUP_KEY claim must have an explicit .catch(() => true) now that Redis errors propagate"
  );
});
