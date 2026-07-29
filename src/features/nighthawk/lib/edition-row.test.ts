import assert from "node:assert/strict";
import test from "node:test";
import { recapOnlyReasonFromMeta } from "./edition-meta";
import { nextTradingDayEt } from "./session";

test("recapOnlyReasonFromMeta surfaces trimmed reason when plays are empty", () => {
  assert.equal(
    recapOnlyReasonFromMeta(
      { recap_only_reason: "  No candidates from any source.  " },
      0
    ),
    "No candidates from any source."
  );
});

test("recapOnlyReasonFromMeta returns null when plays exist", () => {
  assert.equal(
    recapOnlyReasonFromMeta({ recap_only_reason: "should not surface" }, 3),
    null
  );
});

test("recapOnlyReasonFromMeta returns null for missing/blank reason", () => {
  assert.equal(recapOnlyReasonFromMeta({}, 0), null);
  assert.equal(recapOnlyReasonFromMeta({ recap_only_reason: "   " }, 0), null);
  assert.equal(recapOnlyReasonFromMeta(null, 0), null);
});

test("asOfEt session → edition_for is next trading day", () => {
  // Friday session → Monday edition (2026-07-24 is Friday, 2026-07-27 is Monday)
  assert.equal(nextTradingDayEt("2026-07-24"), "2026-07-27");
  assert.equal(nextTradingDayEt("2026-07-28"), "2026-07-29");
});
