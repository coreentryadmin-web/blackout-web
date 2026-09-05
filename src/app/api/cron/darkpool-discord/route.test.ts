import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const routeSrc = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "route.ts"),
  "utf8"
);

// Regression for the 2026-09-04 audit sweep: darkpool-discord calls fetchUwDarkPoolRecent
// (UW REST on cache miss) but was not tagged with runWithBackgroundUwSweep.
test("darkpool-discord imports runWithBackgroundUwSweep from the shared rate limiter", () => {
  assert.match(
    routeSrc,
    /import \{[^}]*\brunWithBackgroundUwSweep\b[^}]*\} from "@\/lib\/providers\/uw-rate-limiter"/,
    "must import the background-sweep tag from the shared rate limiter"
  );
});

test("darkpool-discord wraps UW REST tick in runWithBackgroundUwSweep", () => {
  assert.match(
    routeSrc,
    /await runWithBackgroundUwSweep\(\(\) =>\s*runDarkpoolDiscordTick/,
    "dark pool scan/digest/EOD must run inside the background-sweep tag"
  );
  assert.match(
    routeSrc,
    /async function runDarkpoolDiscordTick[\s\S]*await scanDarkpoolDiscordFromCache/,
    "UW REST work must live inside runDarkpoolDiscordTick, not bare in GET"
  );
});

// Regression for #3960 (CLQ-037/044): sharedCacheSetNx now THROWS on a Redis command error
// instead of silently falling back to an in-memory acquire — every caller must decide fail-open
// vs fail-closed explicitly. This dedup guard is a duplicate-post-tolerant cooldown, so it must
// fail OPEN (post anyway) rather than let a transient Redis blip fail the whole digest run.
test("darkpool-discord digest dedup fails OPEN on a sharedCacheSetNx rejection", () => {
  assert.match(
    routeSrc,
    /await sharedCacheSetNx\(DEDUP_DIGEST_KEY,[\s\S]{0,120}\)\.catch\(\s*\(\) => true\s*\)/,
    "DEDUP_DIGEST_KEY claim must have an explicit .catch(() => true) now that Redis errors propagate"
  );
});
