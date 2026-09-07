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

// Regression for the 2026-09-07 audit sweep (same class as uw-cache-refresh #4482): registry
// declares `market_hours_only: true` but the route had no holiday-aware execution gate.
test("flow-ingest gates on isEtCashRth before UW REST polling", () => {
  assert.match(
    routeSrc,
    /import \{ isEtCashRth \} from "@\/lib\/et-market-hours"/,
    "must import the holiday-aware RTH gate"
  );
  const authAt = routeSrc.indexOf("isCronAuthorized(req)");
  const gateAt = routeSrc.indexOf("isEtCashRth()");
  const ingestAt = routeSrc.indexOf("if (ingestInFlight)");
  assert.ok(authAt >= 0 && gateAt >= 0 && ingestAt >= 0);
  assert.ok(gateAt > authAt, "RTH gate must run after auth");
  assert.ok(gateAt < ingestAt, "RTH gate must run before ingest work starts");
});
