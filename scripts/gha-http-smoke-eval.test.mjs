import test from "node:test";
import assert from "node:assert/strict";
import { spxDeskSmokeVerdict } from "./gha-http-smoke-eval.mjs";

test("spxDeskSmokeVerdict: live RTH desk passes on price > 0", () => {
  const v = spxDeskSmokeVerdict(200, { price: 5912.4, available: true, source: "merged" });
  assert.equal(v.outcome, "pass");
});

test("spxDeskSmokeVerdict: cron auth drift is warn not fail", () => {
  assert.equal(spxDeskSmokeVerdict(401, { error: "Unauthorized" }).outcome, "warn");
});

test("spxDeskSmokeVerdict: authenticated off-hours shell (price 0) is warn not fail", () => {
  const v = spxDeskSmokeVerdict(200, { price: 0, available: false, source: "none" });
  assert.equal(v.outcome, "warn");
  assert.match(v.detail, /off-hours/i);
});

test("spxDeskSmokeVerdict: 5xx and missing route still fail", () => {
  assert.equal(spxDeskSmokeVerdict(502, { error: "Desk build failed" }).outcome, "fail");
  assert.equal(spxDeskSmokeVerdict(404, null).outcome, "fail");
});
