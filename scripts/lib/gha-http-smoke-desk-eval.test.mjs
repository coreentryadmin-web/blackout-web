import test from "node:test";
import assert from "node:assert/strict";
import { spxDeskCronSmokeVerdict } from "./gha-http-smoke-desk-eval.mjs";

test("spxDeskCronSmokeVerdict: live RTH spot passes", () => {
  const v = spxDeskCronSmokeVerdict(200, { price: 5900.12, available: true });
  assert.equal(v.outcome, "pass");
});

test("spxDeskCronSmokeVerdict: cron secret drift warns", () => {
  const v = spxDeskCronSmokeVerdict(401, { error: "Unauthorized" });
  assert.equal(v.outcome, "warn");
  assert.equal(v.code, "cron_secret_drift");
});

test("spxDeskCronSmokeVerdict: off-hours prior_close passes", () => {
  const v = spxDeskCronSmokeVerdict(200, {
    price: 0,
    prior_close: 5788.5,
    market_open: false,
    available: true,
    source: "polygon+uw-flow",
  });
  assert.equal(v.outcome, "pass");
});

test("spxDeskCronSmokeVerdict: authenticated 200 without spot warns (weekend shell)", () => {
  const v = spxDeskCronSmokeVerdict(200, {
    price: 0,
    prior_close: null,
    market_open: false,
    available: false,
    source: "none",
    as_of: "2026-11-08T16:00:00.000Z",
  });
  assert.equal(v.outcome, "warn");
  assert.equal(v.code, "off_hours_no_spot");
});

test("spxDeskCronSmokeVerdict: route missing fails", () => {
  const v = spxDeskCronSmokeVerdict(404, {});
  assert.equal(v.outcome, "fail");
});
