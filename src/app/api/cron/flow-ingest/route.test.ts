import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const routeSrc = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "route.ts"),
  "utf8"
);

// Regression for 2026-09-04 audit sweep: flow-ingest's REST fallback path was the last UW
// fan-out cron not tagged with runWithBackgroundUwSweep, so it could starve live member
// reads on the shared 2 RPS budget during RTH failover (same class as uw-cache-refresh fix).
test("flow-ingest imports runWithBackgroundUwSweep from the shared rate limiter", () => {
  assert.match(
    routeSrc,
    /import \{[^}]*\brunWithBackgroundUwSweep\b[^}]*\} from "@\/lib\/providers\/uw-rate-limiter"/
  );
});

test("flow-ingest wraps runFlowIngest in runWithBackgroundUwSweep", () => {
  assert.match(
    routeSrc,
    /runWithBackgroundUwSweep\(\(\) => runFlowIngest\(\)\)/
  );
  assert.equal(/await runFlowIngest\(\)/.test(routeSrc), false);
});
