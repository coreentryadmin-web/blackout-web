import test from "node:test";
import assert from "node:assert/strict";
import { spxDeskCronDeploySmokeVerdict } from "./gha-http-smoke.mjs";

test("spxDeskCronDeploySmokeVerdict: live price passes", () => {
  const v = spxDeskCronDeploySmokeVerdict(200, { price: 5900.12, market_open: true });
  assert.equal(v.pass, true);
  assert.equal(v.kind, "live");
});

test("spxDeskCronDeploySmokeVerdict: session closed with price 0 passes (weekend deploy-smoke)", () => {
  const v = spxDeskCronDeploySmokeVerdict(200, { price: 0, market_open: false, available: true });
  assert.equal(v.pass, true);
  assert.equal(v.kind, "session_closed");
});

test("spxDeskCronDeploySmokeVerdict: RTH with price 0 fails", () => {
  assert.equal(spxDeskCronDeploySmokeVerdict(200, { price: 0, market_open: true }).pass, false);
});

test("spxDeskCronDeploySmokeVerdict: 401 secret drift warns but passes", () => {
  const v = spxDeskCronDeploySmokeVerdict(401, { error: "Unauthorized" });
  assert.equal(v.pass, true);
  assert.equal(v.warn, "secret_drift");
});
