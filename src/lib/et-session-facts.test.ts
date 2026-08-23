import assert from "node:assert/strict";
import { test } from "node:test";
import { etSessionFacts, ageSecondsFromIso } from "./et-session-facts.ts";

test("the session date is ET, not UTC — the four-hour window where they differ", () => {
  // 2026-08-23T00:00:00Z is Saturday 20:00 ET on 2026-08-22. A UTC-derived date says 2026-08-23,
  // a full session ahead. That is the #2418/#2420 class this field exists to prevent.
  const f = etSessionFacts(new Date("2026-08-23T00:00:00Z"));
  assert.equal(f.session_date, "2026-08-22");
  assert.equal(f.et_time, "20:00 ET");
  assert.equal(f.as_of_et, "2026-08-22 20:00 ET");
});

test("RTH boundaries: open inclusive, close exclusive", () => {
  assert.equal(etSessionFacts(new Date("2026-08-21T13:29:00Z")).market_session, "PRE-MARKET");
  assert.equal(etSessionFacts(new Date("2026-08-21T13:30:00Z")).market_session, "OPEN");
  assert.equal(etSessionFacts(new Date("2026-08-21T19:59:00Z")).market_session, "OPEN");
  assert.equal(etSessionFacts(new Date("2026-08-21T20:00:00Z")).market_session, "AFTER-HOURS");
});

test("weekends are CLOSED and are not trading days", () => {
  const sat = etSessionFacts(new Date("2026-08-22T17:00:00Z")); // 13:00 ET Saturday
  assert.equal(sat.market_session, "CLOSED");
  assert.equal(sat.is_trading_day, false);
});

test("A MARKET HOLIDAY IS CLOSED AT 11AM — the gap marketPhaseFromEt alone leaves open", () => {
  // The substantive reason this helper exists rather than calling marketPhaseFromEt directly.
  // Christmas Day 2026 falls on a Friday: a weekday, mid-session by the clock, and shut.
  // marketPhaseFromEt would say OPEN — its own doc says it models no holiday calendar — while
  // isEtCashRth and the rest of the platform say closed.
  const xmas = etSessionFacts(new Date("2026-12-25T16:00:00Z")); // 11:00 ET, a Friday
  assert.equal(xmas.session_date, "2026-12-25");
  assert.equal(xmas.is_trading_day, false, "Christmas is not a trading day");
  assert.equal(xmas.market_session, "CLOSED", "a holiday is CLOSED whatever the clock says");
});

test("is_trading_day and market_session answer DIFFERENT questions", () => {
  // Overnight on an ordinary trading day: the market is shut right now, but today IS a session.
  // A consumer saying "the market is closed today" needs is_trading_day, not the phase.
  const overnight = etSessionFacts(new Date("2026-08-21T06:00:00Z")); // 02:00 ET Friday
  assert.equal(overnight.market_session, "CLOSED");
  assert.equal(overnight.is_trading_day, true, "Friday is a trading day even at 2am");
});

test("midnight ET renders 00:xx, not ICU's 24:xx", () => {
  // Unnormalised, hour 24 is 1440 minutes — outside every phase window, so it would read CLOSED
  // for the wrong reason and stamp an impossible wall clock.
  const f = etSessionFacts(new Date("2026-08-21T04:07:00Z")); // 00:07 ET
  assert.equal(f.et_time, "00:07 ET");
  assert.equal(f.session_date, "2026-08-21");
  assert.equal(f.market_session, "CLOSED", "00:07 is before the 04:00 pre-market open");
});

test("ageSecondsFromIso reports unusable rather than inventing a number", () => {
  const now = Date.parse("2026-08-23T00:00:00Z");
  assert.equal(ageSecondsFromIso("2026-08-22T23:59:00Z", now), 60);
  assert.equal(ageSecondsFromIso(null, now), null);
  assert.equal(ageSecondsFromIso("not-a-date", now), null);
  // Clock skew: a future stamp is NOT a zero-second-old value. Returning 0 would read as
  // "perfectly fresh", which is the opposite of what an unusable stamp means.
  assert.equal(ageSecondsFromIso("2026-08-23T00:05:00Z", now), null);
});
