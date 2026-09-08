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

// Regression for the 2026-09-07 audit-sweep finding: EventBridge's own schedule
// (cron(*/2 11-21 ? * MON-FRI *)) is a fixed-UTC weekday/hour window with NO holiday awareness, so
// it fires unchanged on a market holiday that falls on a weekday — measured live on Labor Day
// 2026-09-07: 44 runs in 90 minutes while the market was closed all day, each doing the full
// UW/Polygon fan-out. cron-registry.ts already declares this job `market_hours_only: true`, but
// nothing in the route actually enforced that — the registry's stated intent and the route's real
// execution had quietly diverged.
test("uw-cache-refresh gates on isEtCashRth (holiday-aware) before the redis/UW fan-out", () => {
  assert.match(
    routeSrc,
    /import \{ isEtCashRth \} from "@\/lib\/et-market-hours"/,
    "must import the holiday-aware RTH gate, not reimplement a weekday-only check"
  );
  const authAt = routeSrc.indexOf("isCronAuthorized(req)");
  const gateAt = routeSrc.indexOf("isEtCashRth()");
  const redisAt = routeSrc.indexOf("getUwCacheRedis()", routeSrc.indexOf("export async function GET"));
  assert.ok(authAt >= 0 && gateAt >= 0 && redisAt >= 0, "auth check, RTH gate, and redis fetch must all exist");
  assert.ok(gateAt > authAt, "the RTH gate must run after the auth check");
  assert.ok(gateAt < redisAt, "the RTH gate must run BEFORE the redis/UW fan-out — gating late still burns the fetch");
});
