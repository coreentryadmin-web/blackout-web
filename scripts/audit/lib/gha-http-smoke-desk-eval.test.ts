import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateSpxDeskCronProbe } from "./gha-http-smoke-desk-eval.mjs";

test("spx desk cron probe: live RTH price", () => {
  const r = evaluateSpxDeskCronProbe(200, { price: 6123.45, prior_close: 6100 });
  assert.equal(r.pass, true);
  assert.equal(r.kind, "live-price");
});

test("spx desk cron probe: off-hours prior_close grounding", () => {
  const r = evaluateSpxDeskCronProbe(200, { price: 0, prior_close: 5800.12, source: "polygon+uw-flow" });
  assert.equal(r.pass, true);
  assert.equal(r.kind, "off-hours");
});

test("spx desk cron probe: secret drift is warn-pass", () => {
  assert.equal(evaluateSpxDeskCronProbe(401, null).kind, "gated");
  assert.equal(evaluateSpxDeskCronProbe(403, {}).kind, "gated");
});

test("spx desk cron probe: empty weekend shell fails", () => {
  const r = evaluateSpxDeskCronProbe(200, { price: 0, prior_close: null, source: "none" });
  assert.equal(r.pass, false);
});
