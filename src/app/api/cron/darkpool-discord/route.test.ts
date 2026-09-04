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
