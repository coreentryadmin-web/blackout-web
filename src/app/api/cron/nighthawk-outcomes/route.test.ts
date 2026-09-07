import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const routeSrc = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "route.ts"),
  "utf8"
);

test("nighthawk-outcomes gates on isTradingDayEt before outcome grading", () => {
  assert.match(
    routeSrc,
    /import \{ isTradingDayEt \} from "@\/features\/nighthawk\/lib\/session"/,
    "must import the NYSE holiday-aware trading-day gate"
  );
  const authAt = routeSrc.indexOf("isCronAuthorized(req)");
  const gateAt = routeSrc.indexOf("isTradingDayEt(sessionDay)");
  const resolveAt = routeSrc.indexOf("resolvePendingNighthawkOutcomes(");
  assert.ok(authAt >= 0 && gateAt >= 0 && resolveAt >= 0);
  assert.ok(gateAt > authAt, "trading-day gate must run after auth");
  assert.ok(resolveAt > gateAt, "outcome resolver must run after trading-day gate");
  assert.match(routeSrc, /!force && !isTradingDayEt\(sessionDay\)/, "force=1 must bypass holiday gate");
});
