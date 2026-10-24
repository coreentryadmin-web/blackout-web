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

// 2026-10-09 finding: this is the ONLY cron scheduled strictly in the post-close
// (16:00-18:45 ET) band, so it is the one caller for which today's own session is always
// already finished by the time it runs — it must opt into gradeThroughToday so today's
// own closed rows get graded same-day instead of lagging a full calendar day (see
// gradeZeroDteLedger's own doc comment in scan.ts for the full story).
test("zerodte-grade opts into gradeThroughToday so today's own session grades same-day, not next-day", () => {
  assert.match(
    routeSrc,
    /gradeZeroDteLedger\(\s*\/\*\s*force\s*\*\/\s*true,\s*\/\*\s*gradeThroughToday\s*\*\/\s*true\s*\)/,
    "the dedicated post-close cron must call gradeZeroDteLedger(true, true), not the 1-arg default"
  );
});
