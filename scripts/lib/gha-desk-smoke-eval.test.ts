import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateSpxDeskSmoke,
  isApproxUsCashRth,
} from "./gha-desk-smoke-eval.mjs";

/** 2026-11-08 is a Saturday — deploy-smoke failed with cron-authed 200 + price 0 */
const SATURDAY_MIDDAY_ET = new Date("2026-11-08T17:00:00.000Z");

/** 2026-06-04 Wed 14:00 ET (EDT) — mid RTH */
const WEDNESDAY_RTH_ET = new Date("2026-06-04T18:00:00.000Z");

test("evaluateSpxDeskSmoke: live price during RTH is ok", () => {
  const v = evaluateSpxDeskSmoke(
    { status: 200, body: { price: 5900.12, available: true } },
    WEDNESDAY_RTH_ET
  );
  assert.equal(v.outcome, "ok");
  assert.match(v.message, /5900/);
});

test("evaluateSpxDeskSmoke: weekend 200 price 0 warns instead of failing deploy", () => {
  const v = evaluateSpxDeskSmoke(
    { status: 200, body: { price: 0, available: true } },
    SATURDAY_MIDDAY_ET
  );
  assert.equal(v.outcome, "warn");
  assert.match(v.message, /off-hours/i);
});

test("evaluateSpxDeskSmoke: RTH 200 price 0 fails", () => {
  const v = evaluateSpxDeskSmoke(
    { status: 200, body: { price: 0, available: true } },
    WEDNESDAY_RTH_ET
  );
  assert.equal(v.outcome, "fail");
});

test("evaluateSpxDeskSmoke: cron secret drift is warn", () => {
  const v = evaluateSpxDeskSmoke({ status: 401, body: { error: "Unauthorized" } });
  assert.equal(v.outcome, "warn");
});

test("evaluateSpxDeskSmoke: desk build 502 fails", () => {
  const v = evaluateSpxDeskSmoke({
    status: 502,
    body: { available: false, error: "Desk build failed" },
  });
  assert.equal(v.outcome, "fail");
  assert.match(v.message, /502/);
});

test("isApproxUsCashRth: Saturday is false", () => {
  assert.equal(isApproxUsCashRth(SATURDAY_MIDDAY_ET), false);
});
