import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateSpxDeskSmoke } from "./gha-http-smoke-desk-eval.mjs";

test("evaluateSpxDeskSmoke: live price is pass", () => {
  const r = evaluateSpxDeskSmoke(200, { available: true, price: 6012.5, source: "uw" });
  assert.equal(r.verdict, "pass");
});

test("evaluateSpxDeskSmoke: off-hours honest shell is warn not fail", () => {
  const r = evaluateSpxDeskSmoke(200, {
    available: false,
    price: 0,
    source: "none",
    polled_at: "2026-11-08T17:00:00.000Z",
  });
  assert.equal(r.verdict, "warn");
});

test("evaluateSpxDeskSmoke: cron drift 401 is warn", () => {
  assert.equal(evaluateSpxDeskSmoke(401, { error: "Unauthorized" }).verdict, "warn");
});

test("evaluateSpxDeskSmoke: 502 and 404 are fail", () => {
  assert.equal(evaluateSpxDeskSmoke(502, { available: false }).verdict, "fail");
  assert.equal(evaluateSpxDeskSmoke(404, "not found").verdict, "fail");
});

test("evaluateSpxDeskSmoke: 200 HTML-ish body is fail", () => {
  assert.equal(evaluateSpxDeskSmoke(200, "not json").verdict, "fail");
});
