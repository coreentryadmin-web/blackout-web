import test from "node:test";
import assert from "node:assert/strict";
import {
  groundedSpxDeskSpot,
  spxDeskSpotAuditVerdict,
} from "./spx-desk-spot-eval.mjs";

test("groundedSpxDeskSpot: prefers live price", () => {
  const g = groundedSpxDeskSpot({ price: 5900, prior_close: 5800 });
  assert.equal(g.source, "price");
  assert.equal(g.spot, 5900);
});

test("groundedSpxDeskSpot: off-hours prior_close", () => {
  const g = groundedSpxDeskSpot({ price: 0, prior_close: 5800.5 });
  assert.equal(g.source, "prior_close");
});

test("spxDeskSpotAuditVerdict: honest empty desk after close is not P0", () => {
  const v = spxDeskSpotAuditVerdict(
    { price: 0, available: false, market_open: false },
    false
  );
  assert.equal(v.outcome, "skip_empty_off_hours");
});

test("spxDeskSpotAuditVerdict: RTH price 0 still fails", () => {
  const v = spxDeskSpotAuditVerdict({ price: 0, available: true, market_open: true }, true);
  assert.equal(v.outcome, "fail");
});
