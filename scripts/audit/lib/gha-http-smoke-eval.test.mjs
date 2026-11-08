import test from "node:test";
import assert from "node:assert/strict";
import { spxDeskSmokePass } from "./gha-http-smoke-eval.mjs";

test("spxDeskSmokePass: 200 with price passes", () => {
  assert.equal(spxDeskSmokePass(200, { price: 6789.12 }), "ok");
});

test("spxDeskSmokePass: 200 priceless shell requests retry", () => {
  assert.equal(
    spxDeskSmokePass(200, { price: 0, source: "none", available: false }),
    "retry"
  );
});

test("spxDeskSmokePass: auth drift is non-fatal", () => {
  assert.equal(spxDeskSmokePass(401, {}), "auth_drift");
  assert.equal(spxDeskSmokePass(403, {}), "auth_drift");
});

test("spxDeskSmokePass: hard failure statuses do not retry", () => {
  assert.equal(spxDeskSmokePass(502, { price: 0 }), "fail");
  assert.equal(spxDeskSmokePass(404, {}), "fail");
});
