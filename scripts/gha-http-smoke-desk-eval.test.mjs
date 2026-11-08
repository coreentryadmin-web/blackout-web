import assert from "node:assert/strict";
import test from "node:test";

import { deskSmokeVerdict } from "./gha-http-smoke-desk-eval.mjs";

test("desk smoke: live RTH spot passes", () => {
  assert.equal(deskSmokeVerdict(200, { price: 6789.12, available: true }), "pass");
});

test("desk smoke: off-hours honest price:0 passes (deploy-smoke 2026-11-08)", () => {
  assert.equal(deskSmokeVerdict(200, { price: 0, available: false, source: "none" }), "pass");
});

test("desk smoke: cron secret drift is warn not fail", () => {
  assert.equal(deskSmokeVerdict(401, { error: "Unauthorized" }), "warn");
});

test("desk smoke: 502 deploy failure", () => {
  assert.equal(deskSmokeVerdict(502, { available: false, error: "Desk build failed" }), "fail");
});
