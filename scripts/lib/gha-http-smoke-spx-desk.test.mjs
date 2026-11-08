import assert from "node:assert/strict";
import test from "node:test";
import { classifySpxDeskCronProbe } from "./gha-http-smoke-spx-desk.mjs";

test("spx desk smoke: live price passes", () => {
  const v = classifySpxDeskCronProbe({ status: 200, body: { price: 5789.12, available: true } });
  assert.equal(v.pass, true);
  assert.equal(v.kind, "live_price");
});

test("spx desk smoke: authenticated 200 without price is off-hours pass", () => {
  const v = classifySpxDeskCronProbe({ status: 200, body: { available: false, price: 0, source: "none" } });
  assert.equal(v.pass, true);
  assert.equal(v.kind, "reachable_off_hours");
});

test("spx desk smoke: 401 is secret drift pass", () => {
  const v = classifySpxDeskCronProbe({ status: 401, body: { error: "Unauthorized" } });
  assert.equal(v.pass, true);
  assert.equal(v.kind, "secret_drift");
});

test("spx desk smoke: 502 fails", () => {
  const v = classifySpxDeskCronProbe({ status: 502, body: { available: false } });
  assert.equal(v.pass, false);
  assert.equal(v.kind, "fail");
});
