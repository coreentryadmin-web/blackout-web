import test from "node:test";
import assert from "node:assert/strict";
import { spxDeskSpotAuditVerdict } from "./spx-desk-audit-eval.mjs";

test("spxDeskSpotAuditVerdict: live spot required during RTH", () => {
  assert.equal(spxDeskSpotAuditVerdict({ price: 0, available: true }, true), "fail");
  assert.equal(spxDeskSpotAuditVerdict({ price: 5900 }, true), "ok_live");
});

test("spxDeskSpotAuditVerdict: off-hours allows prior_close or honest empty shell", () => {
  assert.equal(
    spxDeskSpotAuditVerdict({ price: 0, prior_close: 6780.12, available: false }, false),
    "ok_offhours"
  );
  assert.equal(
    spxDeskSpotAuditVerdict({ price: 0, available: false }, false),
    "ok_offhours"
  );
});
