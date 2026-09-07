import assert from "node:assert/strict";
import test from "node:test";
import { flipReasonChip } from "./thermal-flip-reason.ts";

test("flipReasonChip — null when flip is resolved", () => {
  assert.equal(flipReasonChip({ flip: 770, reason: "resolved" }), null);
});

test("flipReasonChip — net short everywhere", () => {
  const chip = flipReasonChip({ flip: null, reason: "net_short_everywhere" });
  assert.match(chip?.label ?? "", /net short/i);
});

test("flipReasonChip — insufficient strikes", () => {
  const chip = flipReasonChip({ flip: null, reason: "insufficient_strikes" });
  assert.equal(chip?.label, "Flip N/A");
});
