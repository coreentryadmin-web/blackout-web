import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const routeSrc = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "route.ts"),
  "utf8"
);

// Regression for the 2026-09-04 audit-sweep finding: this cron's 24-way UW/Polygon fan-out
// (5 sector tides + 3 index tickers x 3 fetches + 5 singles + 2 flow-per-strike) was the one
// remaining background sweep NOT tagged with runWithBackgroundUwSweep, unlike vector-dark-pool-
// warm/vector-pick-sweep/vector-full-state-snapshot/bie-full-state-snapshot (all fixed in PR
// #3479). Live CloudWatch showed 939 real "[uw] flow-alerts failed: rate-limiter queue budget
// exceeded" events in one 2.5h RTH window, clustering inside/at-the-start of this cron's own
// measured 20-66s run windows (vs 27 such failures in an equivalent off-hours window) — i.e. this
// cron was starving live member UW requests exactly the way the four already-fixed crons were.
test("uw-cache-refresh imports runWithBackgroundUwSweep from the shared rate limiter", () => {
  assert.match(
    routeSrc,
    /import \{[^}]*\brunWithBackgroundUwSweep\b[^}]*\} from "@\/lib\/providers\/uw-rate-limiter"/,
    "must import the background-sweep tag from the shared rate limiter, not reimplement one"
  );
});

test("uw-cache-refresh's background dispatch is wrapped in runWithBackgroundUwSweep, not called bare", () => {
  const at = routeSrc.indexOf("const dispatchRefresh");
  assert.ok(at >= 0, "dispatchRefresh closure must exist");
  const block = routeSrc.slice(at, routeSrc.indexOf("};", at));
  assert.match(
    block,
    /runWithBackgroundUwSweep\(\(\) => runUwCacheRefreshTasks\(started, redis\)\)/,
    "the 24-way fan-out must run inside the background-sweep tag so it always leaves a UW " +
      "concurrency slot reachable for live member traffic"
  );
  assert.equal(
    /void runUwCacheRefreshTasks\(started, redis\)\.catch/.test(block),
    false,
    "the old untagged call must be gone, not left alongside the new one"
  );
});
