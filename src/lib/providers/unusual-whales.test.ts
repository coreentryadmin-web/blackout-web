import test from "node:test";
import assert from "node:assert/strict";
import { isLiveOdteSession } from "./unusual-whales";

// 2026-07-03 is a US market holiday (July 4th observed) per nighthawk/session.ts's calendar.
test("isLiveOdteSession: false on a market holiday even during normal trading hours", () => {
  assert.equal(isLiveOdteSession(new Date("2026-07-03T15:00:00.000Z")), false); // 11:00 ET
});

test("isLiveOdteSession: false on a weekend", () => {
  assert.equal(isLiveOdteSession(new Date("2026-07-04T15:00:00.000Z")), false); // Saturday
});

test("isLiveOdteSession: false off-hours on an otherwise real trading day", () => {
  assert.equal(isLiveOdteSession(new Date("2026-07-06T09:00:00.000Z")), false); // Mon 05:00 ET — before the 7am window
});

test("isLiveOdteSession: true during the trading window on a real trading day", () => {
  assert.equal(isLiveOdteSession(new Date("2026-07-06T15:00:00.000Z")), true); // Mon 11:00 ET
});
