import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const routeSrc = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "route.ts"),
  "utf8"
);

// Regression for the 2026-09-07 audit sweep: data-correctness verifiers hit UW-backed ladder
// reads but were the remaining UW-heavy cron NOT tagged with runWithBackgroundUwSweep.
test("data-correctness imports runWithBackgroundUwSweep from the shared rate limiter", () => {
  assert.match(
    routeSrc,
    /import \{[^}]*\brunWithBackgroundUwSweep\b[^}]*\} from "@\/lib\/providers\/uw-rate-limiter"/,
    "must import the background-sweep tag from the shared rate limiter"
  );
});

test("data-correctness wraps correctness sweeps in runWithBackgroundUwSweep, not called bare", () => {
  assert.match(
    routeSrc,
    /await runWithBackgroundUwSweep\(\(\) => runFullCorrectness\(tickers\)\)/,
    "full-platform sweep must run inside the background-sweep tag"
  );
  assert.match(
    routeSrc,
    /await runWithBackgroundUwSweep\(\(\) => runHeatmapCorrectness\(tickers\)\)/,
    "heatmap-only sweep must run inside the background-sweep tag"
  );
  assert.doesNotMatch(
    routeSrc,
    /await runFullCorrectness\(tickers\)/,
    "the old untagged full sweep call must be gone"
  );
  assert.doesNotMatch(
    routeSrc,
    /await runHeatmapCorrectness\(tickers\)/,
    "the old untagged heatmap sweep call must be gone"
  );
});
