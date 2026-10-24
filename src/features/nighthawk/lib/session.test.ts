import assert from "node:assert/strict";
import test from "node:test";
import {
  isBeforeOrAtMarketCloseEt,
  isTradingDayEt,
  mostRecentTradingDayEt,
  nextTradingDayEt,
  previousTradingDayEt,
} from "./session";

// The 2026-07-03 (July 4th observed) scenario that motivated the morning-confirm
// holiday guard: Thursday's evening edition must target Monday, and the holiday
// Friday must not read as a trading day.
test("2026-07-03 (July 4th observed) is not a trading day", () => {
  assert.equal(isTradingDayEt("2026-07-03"), false);
  assert.equal(isTradingDayEt("2026-07-02"), true);
  assert.equal(isTradingDayEt("2026-07-06"), true);
});

test("nextTradingDayEt skips the holiday weekend: Thu 07-02 -> Mon 07-06", () => {
  assert.equal(nextTradingDayEt("2026-07-02"), "2026-07-06");
  // From the holiday itself and the weekend, still Monday.
  assert.equal(nextTradingDayEt("2026-07-03"), "2026-07-06");
  assert.equal(nextTradingDayEt("2026-07-05"), "2026-07-06");
});

test("plain weekend skip: Fri -> Mon", () => {
  assert.equal(nextTradingDayEt("2026-07-10"), "2026-07-13");
});

test("previousTradingDayEt skips weekends: Mon -> Fri", () => {
  assert.equal(previousTradingDayEt("2026-07-13"), "2026-07-10");
});

test("previousTradingDayEt skips July-4th observed holiday: Mon 07-06 -> Thu 07-02", () => {
  assert.equal(previousTradingDayEt("2026-07-06"), "2026-07-02");
});

test("previousTradingDayEt is inverse of nextTradingDayEt across a holiday weekend", () => {
  assert.equal(previousTradingDayEt(nextTradingDayEt("2026-07-02")), "2026-07-02");
});

// task #173 (market_regime staleness): mostRecentTradingDayEt is the boundary
// /api/market/regime's GET compares a captured_at against to decide `stale`.
test("mostRecentTradingDayEt returns today when today is itself a trading day", () => {
  assert.equal(mostRecentTradingDayEt(new Date("2026-07-02T14:00:00Z")), "2026-07-02");
});

test("mostRecentTradingDayEt walks back over the July-4th-observed holiday weekend: Sun 07-05 -> Thu 07-02", () => {
  // 07-05 (Sun) -> 07-04 (Sat) -> 07-03 (Fri, holiday) -> 07-02 (Thu, trading day).
  assert.equal(mostRecentTradingDayEt(new Date("2026-07-05T16:00:00Z")), "2026-07-02");
});

test("mostRecentTradingDayEt walks back over a plain weekend: Sat -> Fri", () => {
  assert.equal(mostRecentTradingDayEt(new Date("2026-07-11T16:00:00Z")), "2026-07-10");
});

test("isBeforeOrAtMarketCloseEt keeps an edition active through its session close", () => {
  assert.equal(
    isBeforeOrAtMarketCloseEt("2026-06-30", new Date("2026-06-30T19:59:00Z")),
    true
  );
  assert.equal(
    isBeforeOrAtMarketCloseEt("2026-06-30", new Date("2026-06-30T20:00:00Z")),
    true
  );
  assert.equal(
    isBeforeOrAtMarketCloseEt("2026-06-30", new Date("2026-06-30T20:01:00Z")),
    false
  );
});

// NYSE early-close half-days (Black Friday, Christmas Eve) close at 1:00 PM ET, not 4:00 PM.
// Before this fix, isBeforeOrAtMarketCloseEt hardcoded the 4:00 PM close for every session date,
// so on these two half-days a carried Legacy play (and every other caller: publish-gates.ts's
// trading-day window, day-trade-agent.ts's day-open detection, mobile/signals's own carry check)
// would misjudge the market as still open for three extra hours after the real 1:00 PM close.
test("isBeforeOrAtMarketCloseEt closes at 1 PM ET on Black Friday, not 4 PM", () => {
  // 2026-11-27T17:59:00Z = 2026-11-27T12:59:00 ET (EST, UTC-5) -- before the 1 PM early close.
  assert.equal(
    isBeforeOrAtMarketCloseEt("2026-11-27", new Date("2026-11-27T17:59:00Z")),
    true
  );
  // 2026-11-27T18:00:00Z = 2026-11-27T13:00:00 ET -- exactly at the early close.
  assert.equal(
    isBeforeOrAtMarketCloseEt("2026-11-27", new Date("2026-11-27T18:00:00Z")),
    true
  );
  // 2026-11-27T18:01:00Z = 2026-11-27T13:01:00 ET -- one minute past the early close. The
  // pre-fix hardcoded 4 PM boundary would have wrongly returned true here.
  assert.equal(
    isBeforeOrAtMarketCloseEt("2026-11-27", new Date("2026-11-27T18:01:00Z")),
    false
  );
  // 2026-11-27T20:00:00Z = 2026-11-27T15:00:00 ET -- clearly past the early close, still well
  // before the normal 4 PM close, so this is the clearest possible regression trap.
  assert.equal(
    isBeforeOrAtMarketCloseEt("2026-11-27", new Date("2026-11-27T20:00:00Z")),
    false
  );
});

test("isBeforeOrAtMarketCloseEt closes at 1 PM ET on Christmas Eve, not 4 PM", () => {
  // 2026-12-24T18:00:00Z = 2026-12-24T13:00:00 ET (EST) -- exactly at the early close.
  assert.equal(
    isBeforeOrAtMarketCloseEt("2026-12-24", new Date("2026-12-24T18:00:00Z")),
    true
  );
  // 2026-12-24T19:00:00Z = 2026-12-24T14:00:00 ET -- one hour past the early close.
  assert.equal(
    isBeforeOrAtMarketCloseEt("2026-12-24", new Date("2026-12-24T19:00:00Z")),
    false
  );
});

test("isBeforeOrAtMarketCloseEt still uses the normal 4 PM close on an ordinary session date " +
  "(regression guard: the early-close table must never affect a non-early-close date)", () => {
  assert.equal(
    isBeforeOrAtMarketCloseEt("2026-11-25", new Date("2026-11-25T20:00:00Z")),
    true
  );
  assert.equal(
    isBeforeOrAtMarketCloseEt("2026-11-25", new Date("2026-11-25T21:01:00Z")),
    false
  );
});

test("2028 holidays: MLK, Good Friday, Juneteenth all non-trading", () => {
  assert.equal(isTradingDayEt("2028-01-17"), false);
  assert.equal(isTradingDayEt("2028-04-14"), false);
  assert.equal(isTradingDayEt("2028-06-19"), false);
  assert.equal(isTradingDayEt("2028-07-04"), false);
  assert.equal(isTradingDayEt("2028-12-25"), false);
});

test("2029 holidays: New Year, Good Friday", () => {
  assert.equal(isTradingDayEt("2029-01-01"), false);
  assert.equal(isTradingDayEt("2029-03-30"), false);
});

test("isBeforeOrAtMarketCloseEt does not carry a different session", () => {
  assert.equal(
    isBeforeOrAtMarketCloseEt("2026-07-01", new Date("2026-06-30T19:00:00Z")),
    false
  );
});

// ICU renders ET midnight (00:00-00:59) as hour "24" under `hour12: false`, not "00" — see
// et-session-facts.ts's own normalisation comment for the same quirk. Unnormalised here, the
// 00:00-00:59 ET window computes 1440-1499 minutes, which is > 16*60 and reads as "past close"
// even though the very same session is barely six minutes old. This broke the Night Hawk
// edition route's `carry_until_close` branch every night: a freshly-published edition for the
// upcoming session was served as a stale fallback with a false "not published yet" banner for
// the first hour after midnight ET, every trading day.
test("isBeforeOrAtMarketCloseEt is true in the first minute after midnight ET (ICU hour24 quirk)", () => {
  // 2026-09-10T04:00:00Z = 2026-09-10T00:00:00 ET (EDT, UTC-4).
  assert.equal(isBeforeOrAtMarketCloseEt("2026-09-10", new Date("2026-09-10T04:00:00Z")), true);
  // 2026-09-10T04:59:00Z = 2026-09-10T00:59:00 ET.
  assert.equal(isBeforeOrAtMarketCloseEt("2026-09-10", new Date("2026-09-10T04:59:00Z")), true);
});
