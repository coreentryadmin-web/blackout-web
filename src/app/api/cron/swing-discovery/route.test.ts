import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const routeSrc = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "route.ts"),
  "utf8"
);

test("swing-discovery wraps the scan in runWithBackgroundUwSweep (UW IV/earnings deps)", () => {
  assert.match(
    routeSrc,
    /import \{[^}]*\brunWithBackgroundUwSweep\b[^}]*\} from "@\/lib\/providers\/uw-rate-limiter"/
  );
  assert.match(routeSrc, /runWithBackgroundUwSweep\(\(\) => runSwingDiscoveryScan\(deps\)\)/);
});

test("swing-discovery runs inline so phase-claim release stays synchronous on failure", () => {
  assert.match(routeSrc, /Runs inline \(not after\(\)\) so phase-claim release on failure is synchronous/);
  assert.doesNotMatch(routeSrc, /after\(dispatch/);
});

test("force=1 refuses to delete a LIVE running claim (deep-dive Q1)", () => {
  assert.match(routeSrc, /shouldRefuseForceClearRunningClaim/);
  assert.match(routeSrc, /force_refused: true/);
  assert.match(routeSrc, /force=1 refused —/);
});

test("swing-discovery gates on isTradingDayEt before Polygon/UW whole-market scan", () => {
  assert.match(
    routeSrc,
    /import \{ isTradingDayEt \} from "@\/features\/nighthawk\/lib\/session"/,
    "must import the NYSE holiday-aware trading-day gate"
  );
  const authAt = routeSrc.indexOf("isCronAuthorized(req)");
  const gateAt = routeSrc.indexOf("isTradingDayEt(sessionDay)");
  const scanAt = routeSrc.indexOf("decideSwingScan(");
  assert.ok(authAt >= 0 && gateAt >= 0 && scanAt >= 0);
  assert.ok(gateAt > authAt, "trading-day gate must run after auth");
  assert.ok(scanAt > gateAt, "phase decision must run after trading-day gate");
  assert.match(routeSrc, /!force && !isTradingDayEt\(sessionDay\)/, "force=1 must bypass holiday gate");
});

// BUG FIX (2026-11-09, live 5-engine audit — GET /api/admin/cron-health showed swing-discovery at
// runs_24h:{ok:0,failed:30,skipped:21} with every failure's last_message the shared cluster-wide
// Polygon circuit breaker ("[polygon] Circuit open — rate limited, pausing Xs"), or the raw 429 that
// trips it). This route had two genuinely-unbounded `Promise.all` fan-outs of up to 40 concurrent
// Polygon calls each, relying solely on the shared breaker to self-regulate instead of bounding its
// own concurrency — the same root-cause shape `polygon-rate-limiter.ts`'s own `runPolygonPool` doc
// comment already traces to two prior incidents (vector-dark-pool-warm, vector-universe). Both are
// now routed through that same established pool helper. These tests pin that the fix landed and
// does not silently regress back to a bare `Promise.all` on a future edit — a source-text check
// (mirroring this file's existing style) rather than an executed-concurrency test, because exercising
// the real handler needs a full auth/DB/provider mock harness this route doesn't have (see the other
// tests in this file for the same convention).

test("swing-discovery bounds the intraday-structure minute-bar refresh fan-out via runPolygonPool, not a bare Promise.all", () => {
  assert.match(
    routeSrc,
    /import \{ runPolygonPool \} from "@\/lib\/providers\/polygon-rate-limiter"/,
    "must import the established bounded-Polygon-fan-out pool helper"
  );
  const fnAt = routeSrc.indexOf("fetchIntradayStructureBars: async () => {");
  const bodyEnd = routeSrc.indexOf("return mergeMinuteRefreshedBars(results, refreshed);", fnAt);
  assert.ok(fnAt >= 0 && bodyEnd > fnAt, "fetchIntradayStructureBars dep must exist");
  const body = routeSrc.slice(fnAt, bodyEnd);
  assert.match(
    body,
    /runPolygonPool\(\s*tickers\.map/,
    "the up-to-BREAKOUT_INTRADAY_REFRESH_LIMIT-ticker minute-bar fetch must go through the bounded pool"
  );
  assert.doesNotMatch(
    body,
    /await Promise\.all\(/,
    "no unbounded Promise.all should remain in this fan-out"
  );
});

test("swing-discovery bounds the watch-ticker last-trade refresh fan-out via runPolygonPool, not a bare Promise.all", () => {
  const anchorAt = routeSrc.indexOf("const watchTickers =");
  const blockEnd = routeSrc.indexOf("const flagAnchorsByThesisKey", anchorAt);
  assert.ok(anchorAt >= 0 && blockEnd > anchorAt, "watchTickers refresh block must exist");
  const block = routeSrc.slice(anchorAt, blockEnd);
  assert.match(
    block,
    /runPolygonPool\(\s*watchTickers\.map/,
    "the up-to-40-ticker fetchStockLastTrade refresh must go through the bounded pool"
  );
  assert.doesNotMatch(
    block,
    /await Promise\.all\(/,
    "no unbounded Promise.all should remain in this fan-out"
  );
});
