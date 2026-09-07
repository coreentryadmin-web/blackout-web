import test from "node:test";
import assert from "node:assert/strict";
import { isTradingDayEt, todayEtYmd, isMarketHolidayEt } from "./gha-et-window.mjs";

test("isMarketHolidayEt: Labor Day 2026-09-07", () => {
  assert.equal(isMarketHolidayEt("2026-09-07"), true);
});

test("isTradingDayEt: Labor Day 2026-09-07 is not a trading session", () => {
  assert.equal(isTradingDayEt("2026-09-07"), false);
});

test("isTradingDayEt: adjacent weekday sessions remain trading days", () => {
  assert.equal(isTradingDayEt("2026-09-04"), true); // Fri before Labor Day
  assert.equal(isTradingDayEt("2026-09-08"), true); // Tue after Labor Day
});

test("todayEtYmd: formats ET calendar date", () => {
  const laborDay = new Date("2026-09-07T16:00:00Z"); // noon ET
  assert.equal(todayEtYmd(laborDay), "2026-09-07");
});
