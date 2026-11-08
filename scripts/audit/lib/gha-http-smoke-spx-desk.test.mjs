import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateSpxDeskCronSmoke,
  inCashEquityRth,
} from "./gha-http-smoke-spx-desk.mjs";

test("inCashEquityRth: Sunday is false", () => {
  assert.equal(inCashEquityRth(new Date("2026-11-08T17:00:00Z")), false);
});

test("evaluateSpxDeskCronSmoke: live price passes", () => {
  const v = evaluateSpxDeskCronSmoke(200, { price: 6789.12, available: true });
  assert.equal(v.outcome, "pass");
  assert.match(v.line, /6789/);
});

test("evaluateSpxDeskCronSmoke: 401 warns", () => {
  const v = evaluateSpxDeskCronSmoke(401, { error: "Unauthorized" });
  assert.equal(v.outcome, "warn");
});

test("evaluateSpxDeskCronSmoke: 502 fails", () => {
  const v = evaluateSpxDeskCronSmoke(502, { available: false });
  assert.equal(v.outcome, "fail");
});

test("evaluateSpxDeskCronSmoke: honest unavailable passes", () => {
  const v = evaluateSpxDeskCronSmoke(200, { available: false, price: 0 });
  assert.equal(v.outcome, "pass");
});

test("evaluateSpxDeskCronSmoke: Sunday 200 without price passes when payload valid", () => {
  const sun = new Date("2026-11-08T17:03:00Z");
  const v = evaluateSpxDeskCronSmoke(
    200,
    { available: true, price: 0, as_of: "2026-11-07T20:00:00.000Z" },
    sun
  );
  assert.equal(v.outcome, "pass");
});

test("evaluateSpxDeskCronSmoke: RTH weekday with available true and price 0 fails", () => {
  const wedRth = new Date("2026-11-05T15:00:00Z"); // Wed 10:00 ET
  const v = evaluateSpxDeskCronSmoke(
    200,
    { available: true, price: 0 },
    wedRth
  );
  assert.equal(v.outcome, "fail");
});
