import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const routeSrc = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "route.ts"),
  "utf8"
);

// Regression for the 2026-09-04 audit sweep: flow-ingest calls fetchMarketFlowAlertRows
// (UW REST) but was the one remaining UW-heavy cron NOT tagged with runWithBackgroundUwSweep.
test("flow-ingest imports runWithBackgroundUwSweep from the shared rate limiter", () => {
  assert.match(
    routeSrc,
    /import \{[^}]*\brunWithBackgroundUwSweep\b[^}]*\} from "@\/lib\/providers\/uw-rate-limiter"/,
    "must import the background-sweep tag from the shared rate limiter"
  );
});

test("flow-ingest wraps runFlowIngest in runWithBackgroundUwSweep, not called bare", () => {
  assert.match(
    routeSrc,
    /await runWithBackgroundUwSweep\(\(\) => runFlowIngest\(\)\)/,
    "REST flow_alerts polling must run inside the background-sweep tag so it leaves a UW " +
      "concurrency slot reachable for live member traffic"
  );
  assert.doesNotMatch(
    routeSrc,
    /await runFlowIngest\(\)/,
    "the old untagged call must be gone"
  );
});
