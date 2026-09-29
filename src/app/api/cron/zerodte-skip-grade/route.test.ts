import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const routeSrc = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "route.ts"),
  "utf8"
);

test("zerodte-skip-grade gates on isTradingDayEt before runSkipGrading", () => {
  assert.match(
    routeSrc,
    /import \{ isTradingDayEt \} from "@\/features\/nighthawk\/lib\/session"/,
    "must import the NYSE holiday-aware trading-day gate"
  );
  assert.match(
    routeSrc,
    /import \{ runSkipGrading \} from "@\/lib\/zerodte\/skip-grading"/,
    "must call the real counterfactual skip-grader, not reimplement it"
  );
  const authAt = routeSrc.indexOf("isCronAuthorized(req)");
  const gateAt = routeSrc.indexOf("isTradingDayEt(sessionDay)");
  const gradeAt = routeSrc.indexOf("runSkipGrading(");
  assert.ok(authAt >= 0 && gateAt >= 0 && gradeAt >= 0);
  assert.ok(gateAt > authAt, "trading-day gate must run after auth");
  assert.ok(gradeAt > gateAt, "skip grading must run after the trading-day gate");
  assert.match(routeSrc, /!force && !isTradingDayEt\(sessionDay\)/, "force=1 must bypass holiday gate");
});

test("zerodte-skip-grade never gates on requireAdminApi — it's a cron route, not the admin-only manual trigger", () => {
  assert.doesNotMatch(
    routeSrc,
    /requireAdminApi/,
    "this route must stay cron-authorized (isCronAuthorized), matching zerodte-grade's own pattern " +
      "— admin gating belongs to the manual POST /api/market/zerodte/calibration?grade_skips=1 trigger only"
  );
});
