import assert from "node:assert/strict";
import test from "node:test";
import { spxDeskCronSmokeVerdict } from "./gha-http-smoke-spx-desk-eval.mjs";

test("spx desk smoke: live price passes", () => {
  const r = spxDeskCronSmokeVerdict(200, { price: 6789.12, available: true });
  assert.equal(r.ok, true);
  assert.equal(r.verdict, "live");
});

test("spx desk smoke: cron 200 with price 0 is degraded pass (weekend/off-hours)", () => {
  const r = spxDeskCronSmokeVerdict(200, { price: 0, available: false, market_open: false });
  assert.equal(r.ok, true);
  assert.equal(r.verdict, "degraded");
  assert.ok(r.warn);
});

test("spx desk smoke: auth drift 401/403 passes with warn", () => {
  assert.equal(spxDeskCronSmokeVerdict(401, {}).ok, true);
  assert.equal(spxDeskCronSmokeVerdict(403, {}).verdict, "gated");
});

test("spx desk smoke: 502 and missing route fail", () => {
  assert.equal(spxDeskCronSmokeVerdict(502, { error: "Desk build failed" }).ok, false);
  assert.equal(spxDeskCronSmokeVerdict(404, {}).ok, false);
});
