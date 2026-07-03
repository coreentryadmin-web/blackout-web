import assert from "node:assert/strict";
import { expectLiveMarketWriters, formatEtDate, isMarketHolidayEt, isTradingDayEt } from "./trading-calendar.mjs";

assert.equal(isMarketHolidayEt("2026-07-03"), true);
assert.equal(isTradingDayEt(new Date("2026-07-03T15:00:00.000Z")), false);
assert.equal(isTradingDayEt(new Date("2026-07-02T15:00:00.000Z")), true);
assert.equal(formatEtDate(new Date("2026-07-03T15:00:00.000Z")), "2026-07-03");
assert.equal(expectLiveMarketWriters(new Date("2026-07-03T15:00:00.000Z")), false);

console.log("trading-calendar: ok");
