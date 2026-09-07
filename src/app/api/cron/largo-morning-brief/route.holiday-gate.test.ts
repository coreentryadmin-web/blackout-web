import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const routeSrc = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "route.ts"),
  "utf8"
);

test("largo-morning-brief gates on isTradingDayEt before building the brief", () => {
  assert.match(
    routeSrc,
    /import \{ isTradingDayEt, todayEt \} from "@\/features\/nighthawk\/lib\/session"/,
    "must import the NYSE holiday-aware trading-day gate"
  );
  const authAt = routeSrc.indexOf("isCronAuthorized(req)");
  const windowAt = routeSrc.indexOf("inMorningWindow(force)");
  const gateAt = routeSrc.indexOf("isTradingDayEt(sessionDay)");
  const buildAt = routeSrc.indexOf("buildLargoMorningBrief(");
  assert.ok(authAt >= 0 && windowAt >= 0 && gateAt >= 0 && buildAt >= 0);
  assert.ok(windowAt > authAt, "ET window gate must run after auth");
  assert.ok(gateAt > windowAt, "trading-day gate must run after ET window gate");
  assert.ok(buildAt > gateAt, "brief builder must run after trading-day gate");
  assert.match(routeSrc, /!force && !isTradingDayEt\(sessionDay\)/, "force=1 must bypass holiday gate");
});
