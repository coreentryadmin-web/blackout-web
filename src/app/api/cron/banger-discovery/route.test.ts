import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const routeSrc = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "route.ts"),
  "utf8"
);

test("banger-discovery gates on isTradingDayEt before grouped-daily screening", () => {
  assert.match(
    routeSrc,
    /import \{ isTradingDayEt \} from "@\/features\/nighthawk\/lib\/session"/,
    "must import the NYSE holiday-aware trading-day gate"
  );
  const authAt = routeSrc.indexOf("isCronAuthorized(req)");
  const gateAt = routeSrc.indexOf("isTradingDayEt(sessionDate)");
  const windowAt = routeSrc.indexOf("!inBangerDiscoveryWindow(new Date(started))");
  assert.ok(authAt >= 0 && gateAt >= 0 && windowAt >= 0);
  assert.ok(gateAt > authAt, "trading-day gate must run after auth");
  assert.ok(windowAt > gateAt, "post-close window guard must run after trading-day gate");
  assert.match(routeSrc, /!force && !isTradingDayEt\(sessionDate\)/, "force=1 must bypass holiday gate");
});
