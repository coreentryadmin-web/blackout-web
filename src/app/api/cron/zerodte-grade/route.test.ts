import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const routeSrc = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "route.ts"),
  "utf8"
);

test("zerodte-grade gates on isTradingDayEt before ledger grading", () => {
  assert.match(
    routeSrc,
    /import \{ isTradingDayEt \} from "@\/features\/nighthawk\/lib\/session"/,
    "must import the NYSE holiday-aware trading-day gate"
  );
  const authAt = routeSrc.indexOf("isCronAuthorized(req)");
  const gateAt = routeSrc.indexOf("isTradingDayEt(sessionDay)");
  const gradeAt = routeSrc.indexOf("gradeZeroDteLedger(");
  assert.ok(authAt >= 0 && gateAt >= 0 && gradeAt >= 0);
  assert.ok(gateAt > authAt, "trading-day gate must run after auth");
  assert.ok(gradeAt > gateAt, "ledger grading must run after trading-day gate");
  assert.match(routeSrc, /!force && !isTradingDayEt\(sessionDay\)/, "force=1 must bypass holiday gate");
});
