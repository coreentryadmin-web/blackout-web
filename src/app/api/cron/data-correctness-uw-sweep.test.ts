import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const routeSrc = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "data-correctness", "route.ts"),
  "utf8"
);

// Regression for 2026-09-05 audit sweep: data-correctness's full-platform sweep hits UW oracle
// reads (fetchSpxOdteScopedUwLadder via desk/heatmap verifiers) but was the remaining background
// cron without runWithBackgroundUwSweep, unlike desk-warm/uw-cache-refresh/vector-universe-snapshot.
test("data-correctness imports runWithBackgroundUwSweep from the shared rate limiter", () => {
  assert.match(
    routeSrc,
    /import \{[^}]*\brunWithBackgroundUwSweep\b[^}]*\} from "@\/lib\/providers\/uw-rate-limiter"/,
    "must import the background-sweep tag from the shared rate limiter"
  );
});

test("data-correctness background dispatch is wrapped in runWithBackgroundUwSweep", () => {
  const at = routeSrc.indexOf("const dispatchSweep");
  assert.ok(at >= 0, "dispatchSweep closure must exist");
  const block = routeSrc.slice(at, routeSrc.indexOf("};", at));
  assert.match(
    block,
    /void runWithBackgroundUwSweep\(async \(\) =>/,
    "the async ?force=1 sweep must run inside the background-sweep tag"
  );
  assert.doesNotMatch(
    block,
    /void \(async \(\) =>/,
    "the old untagged async IIFE must be gone"
  );
});

test("data-correctness synchronous full sweep uses runWithBackgroundUwSweep", () => {
  assert.match(
    routeSrc,
    /await runWithBackgroundUwSweep\(\(\) => runFullCorrectness\(tickers\)\)/,
    "scheduled sync full-platform sweep must also reserve a UW slot for live traffic"
  );
});
