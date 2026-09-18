import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const routeSrc = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "route.ts"),
  "utf8"
);

test("x-engage gates on isTradingDayEt before running the engagement sweep", () => {
  assert.match(
    routeSrc,
    /import \{ isTradingDayEt \} from "@\/features\/nighthawk\/lib\/session"/,
    "must import the NYSE holiday-aware trading-day gate"
  );
  const authAt = routeSrc.indexOf("isCronAuthorized(req)");
  const gateAt = routeSrc.indexOf("isTradingDayEt(sessionDay)");
  const sweepAt = routeSrc.indexOf("runEngagementSweep(");
  assert.ok(authAt >= 0 && gateAt >= 0 && sweepAt >= 0);
  assert.ok(gateAt > authAt, "trading-day gate must run after auth");
  assert.ok(sweepAt > gateAt, "engagement sweep must run after trading-day gate");
  assert.match(routeSrc, /!force && !isTradingDayEt\(sessionDay\)/, "force=1 must bypass holiday gate");
});
