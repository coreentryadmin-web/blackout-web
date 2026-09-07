import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const routeSrc = readFileSync(join(import.meta.dirname, "..", "scripts", "rth-open-check.mjs"), "utf8");

test("rth-open-check skips entirely on NYSE holidays unless --force", () => {
  assert.match(routeSrc, /isTradingDayEt\(sessionYmd\)/, "must use NYSE holiday calendar");
  assert.match(
    routeSrc,
    /US market holiday — skipping RTH-open checks/,
    "must exit before validate:deploy on holidays"
  );
  const holidayAt = routeSrc.indexOf("!isTradingDayEt(sessionYmd)");
  const deployAt = routeSrc.indexOf("validate-deploy.mjs");
  assert.ok(holidayAt >= 0 && deployAt >= 0);
  assert.ok(holidayAt < deployAt, "holiday gate must run before post-deploy validation");
});
