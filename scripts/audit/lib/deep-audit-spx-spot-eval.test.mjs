import test from "node:test";
import assert from "node:assert/strict";
import { spxDeskSpotAuditVerdict } from "./deep-audit-spx-spot-eval.mjs";

test("live RTH requires positive spot", () => {
  const v = spxDeskSpotAuditVerdict({ spot: 5800, priorClose: 5790, sessionOpen: true });
  assert.equal(v.ok, true);
  assert.equal(v.kind, "live");
});

test("post-close: price 0 passes when prior_close is grounded", () => {
  const v = spxDeskSpotAuditVerdict({ spot: 0, priorClose: 5785, sessionOpen: false });
  assert.equal(v.ok, true);
  assert.equal(v.kind, "off_hours_prior_close");
});

test("post-close without prior_close still fails", () => {
  const v = spxDeskSpotAuditVerdict({ spot: 0, priorClose: null, sessionOpen: false });
  assert.equal(v.ok, false);
});
