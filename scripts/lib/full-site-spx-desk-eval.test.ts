import assert from "node:assert/strict";
import test from "node:test";

import { spxDeskSpotSeverity } from "./full-site-spx-desk-eval.mjs";

test("spxDeskSpotSeverity: honest empty desk skips spot P0", () => {
  const v = spxDeskSpotSeverity({ spot: 0, available: false, inCashRthSession: true });
  assert.equal(v.severity, "skip");
});

test("spxDeskSpotSeverity: off-hours price 0 skips (RTH deep audit run 42718407755)", () => {
  const v = spxDeskSpotSeverity({ spot: 0, available: true, inCashRthSession: false });
  assert.equal(v.severity, "skip");
});

test("spxDeskSpotSeverity: in-session price 0 is P0", () => {
  const v = spxDeskSpotSeverity({ spot: 0, available: true, inCashRthSession: true });
  assert.equal(v.severity, "P0");
});
