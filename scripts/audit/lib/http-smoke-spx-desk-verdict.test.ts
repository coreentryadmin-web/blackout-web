import assert from "node:assert/strict";
import { test } from "node:test";
import { spxDeskCronSmokeVerdict } from "./http-smoke-spx-desk-verdict.mjs";

test("spxDeskCronSmokeVerdict: live price passes ok", () => {
  const v = spxDeskCronSmokeVerdict(200, { price: 6012.5, available: true });
  assert.equal(v.pass, true);
  assert.equal(v.level, "ok");
});

test("spxDeskCronSmokeVerdict: cron-authenticated off-hours desk passes warn (deploy-smoke 2026-11-08)", () => {
  const v = spxDeskCronSmokeVerdict(200, { price: 0, available: false, market_open: false });
  assert.equal(v.pass, true);
  assert.equal(v.level, "warn");
});

test("spxDeskCronSmokeVerdict: secret drift 401 passes warn", () => {
  const v = spxDeskCronSmokeVerdict(401, { error: "Unauthorized" });
  assert.equal(v.pass, true);
  assert.equal(v.level, "warn");
});

test("spxDeskCronSmokeVerdict: 404 fails", () => {
  const v = spxDeskCronSmokeVerdict(404, {});
  assert.equal(v.pass, false);
});
