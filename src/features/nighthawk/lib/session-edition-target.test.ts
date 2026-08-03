import assert from "node:assert/strict";
import test from "node:test";
import { nextTradingDayEt } from "./session";

test("Sunday session targets Monday edition_for", () => {
  assert.equal(nextTradingDayEt("2026-08-02"), "2026-08-03");
});

test("Friday session targets Monday edition_for", () => {
  assert.equal(nextTradingDayEt("2026-07-31"), "2026-08-03");
});
