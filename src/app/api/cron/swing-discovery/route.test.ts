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
