import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyRegime, classifyCalendar, type RegimeInput } from "./regime.ts";

function base(over: Partial<RegimeInput>): RegimeInput {
  return {
    open: 600, last: 600, high: 602, low: 598, prevClose: 600, prevHigh: 604, prevLow: 596,
    vwap: 600, atr: 8, vwapCrosses: 1, vix: 15, dateYmd: "2026-07-23", isFedDay: false, ...over,
  };
}

test("trend-up day: big move up, closes near high, above VWAP", () => {
  const r = classifyRegime(base({ open: 600, last: 610, high: 611, low: 599, vwap: 605, prevHigh: 602 }));
  assert.equal(r.structure, "TREND_UP");
});

test("trend-down day: big move down, closes near low, below VWAP", () => {
  const r = classifyRegime(base({ open: 600, last: 590, high: 601, low: 589, vwap: 595, prevClose: 602, prevHigh: 603 }));
  assert.equal(r.structure, "TREND_DOWN");
});

test("range day: many VWAP crosses overrides a marginal trend read", () => {
  // prevHigh/Low tight so today breaks the prior range (not an inside day); chop → RANGE
  const r = classifyRegime(base({ open: 600, last: 601, high: 603, low: 597, vwap: 600, vwapCrosses: 7, prevHigh: 601, prevLow: 599 }));
  assert.equal(r.structure, "RANGE");
});

test("inside day: today's range within yesterday's", () => {
  const r = classifyRegime(base({ high: 601, low: 599, prevHigh: 605, prevLow: 595 }));
  assert.equal(r.structure, "INSIDE");
});

test("gap up / gap down detected off prior close", () => {
  assert.equal(classifyRegime(base({ open: 605, prevClose: 600 })).gap, "GAP_UP");
  assert.equal(classifyRegime(base({ open: 595, prevClose: 600 })).gap, "GAP_DOWN");
  assert.equal(classifyRegime(base({ open: 600.5, prevClose: 600 })).gap, "FLAT");
});

test("vol regime bands track VIX (14 / 17 / 20 boundaries)", () => {
  assert.equal(classifyRegime(base({ vix: 12 })).vol, "LOW_IV");
  assert.equal(classifyRegime(base({ vix: 15 })).vol, "NORMAL_IV");
  assert.equal(classifyRegime(base({ vix: 18 })).vol, "ELEVATED_IV");
  assert.equal(classifyRegime(base({ vix: 25 })).vol, "HIGH_IV");
});

test("calendar: 3rd-Friday OPEX and quarterly quad-witching", () => {
  const june = classifyCalendar("2026-06-19"); // 3rd Friday of June (a quarterly month)
  assert.equal(june.opex, true);
  assert.equal(june.quarterlyOpex, true);
  const july = classifyCalendar("2026-07-17"); // 3rd Friday of July (not quarterly)
  assert.equal(july.opex, true);
  assert.equal(july.quarterlyOpex, false);
  const midweek = classifyCalendar("2026-07-22"); // a Wednesday
  assert.equal(midweek.opex, false);
});

test("calendar: month-end and quarter-end", () => {
  assert.equal(classifyCalendar("2026-06-30").quarterEnd, true); // June = quarter close
  assert.equal(classifyCalendar("2026-06-30").monthEnd, true);
  assert.equal(classifyCalendar("2026-07-31").monthEnd, true);
  assert.equal(classifyCalendar("2026-07-31").quarterEnd, false); // July is not a quarter month
  assert.equal(classifyCalendar("2026-07-15").monthEnd, false);
});

test("Fed day is passed through and tagged", () => {
  const r = classifyRegime(base({ isFedDay: true }));
  assert.equal(r.calendar.fedDay, true);
  assert.ok(r.tags.includes("FED_DAY"));
});

test("tags + label always carry structure and vol", () => {
  const r = classifyRegime(base({ open: 600, last: 610, high: 611, low: 599, vwap: 605, prevHigh: 602, vix: 18, dateYmd: "2026-06-19", isFedDay: true }));
  assert.ok(r.tags.includes("TREND_UP"));
  assert.ok(r.tags.includes("ELEVATED_IV"));
  assert.ok(r.tags.includes("QUAD_WITCHING"));
  assert.ok(r.tags.includes("FED_DAY"));
  assert.ok(r.label.length > 0);
});
