import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isEtCashRth,
  spxDeskHasGroundedSpot,
  spxDeskSmokeVerdict,
} from "./gha-http-smoke-desk-eval.mjs";

test("spxDeskHasGroundedSpot accepts live price or off-hours prior_close", () => {
  assert.equal(spxDeskHasGroundedSpot({ price: 6780.12 }), true);
  assert.equal(spxDeskHasGroundedSpot({ price: 0, prior_close: 6780.12 }), true);
  assert.equal(spxDeskHasGroundedSpot({ price: 0, available: false }), false);
});

test("spxDeskSmokeVerdict: Sunday 200 without spot is pass_offhours", () => {
  const sunday = new Date("2026-11-08T17:03:46.000Z");
  assert.equal(isEtCashRth(sunday), false);
  assert.equal(
    spxDeskSmokeVerdict(200, { available: false, price: 0, source: "none" }, sunday),
    "pass_offhours"
  );
});

test("spxDeskSmokeVerdict: weekday RTH 200 without spot is fail", () => {
  const rth = new Date("2026-11-06T15:00:00.000Z"); // Fri 10:00 ET (EST)
  assert.equal(isEtCashRth(rth), true);
  assert.equal(spxDeskSmokeVerdict(200, { available: false, price: 0 }, rth), "fail");
});

test("spxDeskSmokeVerdict: 401 is warn_auth_drift", () => {
  assert.equal(spxDeskSmokeVerdict(401, {}), "warn_auth_drift");
});
