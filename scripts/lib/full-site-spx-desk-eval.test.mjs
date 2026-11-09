import test from "node:test";
import assert from "node:assert/strict";
import { evaluateFullSiteSpxDeskSpot } from "./full-site-spx-desk-eval.mjs";

test("evaluateFullSiteSpxDeskSpot: positive spot in RTH is ok", () => {
  const v = evaluateFullSiteSpxDeskSpot({ spot: 6712.5, available: true, rthLive: true });
  assert.equal(v.outcome, "ok");
});

test("evaluateFullSiteSpxDeskSpot: available:false skips spot requirement", () => {
  const v = evaluateFullSiteSpxDeskSpot({ spot: 0, available: false, rthLive: true });
  assert.equal(v.outcome, "skip");
});

test("evaluateFullSiteSpxDeskSpot: zero spot off-hours skips not P0", () => {
  const v = evaluateFullSiteSpxDeskSpot({ spot: 0, available: true, rthLive: false });
  assert.equal(v.outcome, "skip");
});

test("evaluateFullSiteSpxDeskSpot: zero spot during RTH fails P0", () => {
  const v = evaluateFullSiteSpxDeskSpot({ spot: 0, available: true, rthLive: true });
  assert.equal(v.outcome, "fail");
  assert.equal(v.severity, "P0");
});
