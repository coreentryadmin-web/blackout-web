import test from "node:test";
import assert from "node:assert/strict";

import {
  classifyEtDay,
  formatSessionCalendarBlock,
  upcomingSessions,
  weekdayEt,
} from "./session-calendar";

/**
 * THE PRODUCTION FAILURE, pinned.
 *
 * A member asked "how is SPX looking for 8/23? what is a good play?" on Thursday 2026-08-20.
 * Largo replied "For 8/23 (Friday, 3 DTE into the close)" and built an entire thesis — walls,
 * invalidation, "into Friday close" — on it.
 *
 * 2026-08-23 is a SUNDAY. There is no 8/23 SPX expiry.
 *
 * The turn block supplied only `Session date (ET): 2026-08-20`, so the weekday was left to
 * inference and nothing in the prompt could contradict the guess. These tests pin the data that
 * makes the guess unnecessary.
 */

test("REGRESSION: 2026-08-23 is a Sunday, not a Friday", () => {
  assert.equal(weekdayEt("2026-08-23"), "Sunday");
  assert.equal(classifyEtDay("2026-08-23").kind, "weekend");
});

test("weekdayEt is not shifted by the UTC-midnight parsing trap", () => {
  // `new Date("2026-08-23")` is UTC midnight, which is 2026-08-22 20:00 in ET — so a naive
  // implementation reports Saturday for every date. The noon anchor is what prevents that.
  assert.equal(weekdayEt("2026-08-20"), "Thursday");
  assert.equal(weekdayEt("2026-08-21"), "Friday");
  assert.equal(weekdayEt("2026-08-24"), "Monday");
});

test("classifyEtDay separates weekend from holiday", () => {
  assert.equal(classifyEtDay("2026-08-20").kind, "trading");
  assert.equal(classifyEtDay("2026-08-22").kind, "weekend");
  // Labor Day 2026 — a Monday in the NYSE table, so it can only be caught by the holiday set.
  assert.equal(classifyEtDay("2026-09-07").kind, "holiday");
  assert.equal(weekdayEt("2026-09-07"), "Monday");
});

test("upcomingSessions skips the weekend and reports what it skipped", () => {
  const { trading, skipped } = upcomingSessions("2026-08-20", 3);
  assert.deepEqual(
    trading.map((d) => d.ymd),
    ["2026-08-21", "2026-08-24", "2026-08-25"]
  );
  // The skipped half is the load-bearing part: it is what tells the model 8/22 and 8/23 exist as
  // calendar dates but not as sessions.
  assert.deepEqual(
    skipped.map((d) => d.ymd),
    ["2026-08-22", "2026-08-23"]
  );
  assert.ok(skipped.every((d) => d.kind === "weekend"));
});

test("upcomingSessions walks a holiday week without stalling", () => {
  // Labor Day Monday 2026-09-07 must be skipped, not returned as a session.
  const { trading, skipped } = upcomingSessions("2026-09-04", 2);
  assert.deepEqual(
    trading.map((d) => d.ymd),
    ["2026-09-08", "2026-09-09"]
  );
  assert.ok(
    skipped.some((d) => d.ymd === "2026-09-07" && d.kind === "holiday"),
    "Labor Day must be reported as a skipped holiday"
  );
});

test("the block states today's weekday, the sessions, and the non-sessions", () => {
  const block = formatSessionCalendarBlock("2026-08-20", 3);
  assert.match(block, /Session date \(ET\): 2026-08-20 \(Thursday\)/);
  assert.match(block, /2026-08-21 \(Friday\)/);
  // The exact date that was hallucinated must appear, labelled as a weekend.
  assert.match(block, /2026-08-23 \(Sunday\) — weekend/);
});

test("the block carries an instruction, not just data", () => {
  // Supplying the calendar without saying what to do with it still permits "8/23 (Friday)".
  // The model has to be told a member-named date is a claim to CHECK, not a premise to accept.
  const block = formatSessionCalendarBlock("2026-08-20");
  assert.match(block, /DATE RULE/);
  assert.match(block, /never build a thesis/i);
  assert.match(block, /Never infer a weekday/i);
});

test("a non-trading 'today' is labelled as such", () => {
  // The desk runs over weekends; the member sees Largo on a Sunday. Reporting a Sunday as a
  // plain session date is the same class of error as the original bug.
  const block = formatSessionCalendarBlock("2026-08-23", 2);
  assert.match(block, /2026-08-23 \(Sunday\) — NOT a trading day \(weekend\)/);
  assert.match(block, /2026-08-24 \(Monday\)/);
});

/**
 * "0DTE" kept meaning a session that had already settled.
 *
 * MEASURED ON PROD 2026-08-20 at ~16:45 ET, after the cash close. Asked "What is the current 0DTE
 * max pain?", Largo answered "SPX 0DTE max pain is **7685**".
 *
 * 7685 was CORRECT — it is the max pain for 2026-08-21, and the chain had properly rolled
 * (`expiries[0] = "2026-08-21"`, verified live). The DATA layer was right. The LABEL was wrong:
 * post-close, 8/21 is 1DTE. Right number, settled session — the same family as the Sunday-expiry
 * defect, on a term where a trader depends on the precision.
 *
 * WHY IT SHIPPED. The block already carried the session DATE and a rule saying "before you state a
 * weekday, a DTE, or an expiry ... check it here" — but nothing told it whether that session was
 * still open, so `0DTE = today` was the only inference available. Market phase WAS computed and
 * DID reach the prompt, but only as a voice instruction ("Off-hours: shorter answers"). Once again
 * the fact existed and was not wired to the rule that needed it.
 */

test("REGRESSION: after the close, the block says today's expiry has settled", () => {
  // 16:45 ET on a Thursday.
  const block = formatSessionCalendarBlock("2026-08-20", 3, 16 * 60 + 45);
  assert.match(block, /EXPIRY STATUS/);
  assert.match(block, /today's \(2026-08-20\) options have SETTLED/);
  assert.match(block, /"0DTE" no longer refers to 2026-08-20/);
  // It must name the expiry that IS now the front one, not just deny the old one.
  assert.match(block, /front expiry is now 2026-08-21/);
  assert.match(block, /1DTE until that session opens/);
});

test("THE CASE THAT WOULD HAVE BEEN A NEW BUG: 2am is not 'settled'", () => {
  // `marketPhase === "CLOSED"` covers 11pm Thursday (today HAS settled) AND 2am Thursday (today
  // has NOT). Deriving `settled` from the phase enum would announce a settled expiry twelve hours
  // early. This is why the decision lives here, where the trading-day classification is.
  const early = formatSessionCalendarBlock("2026-08-20", 3, 2 * 60);
  assert.doesNotMatch(early, /EXPIRY STATUS/, "2am: today's expiry is still ahead");
  const preMarket = formatSessionCalendarBlock("2026-08-20", 3, 8 * 60);
  assert.doesNotMatch(preMarket, /EXPIRY STATUS/, "pre-market: still ahead");
  const rth = formatSessionCalendarBlock("2026-08-20", 3, 12 * 60);
  assert.doesNotMatch(rth, /EXPIRY STATUS/, "mid-session: 0DTE genuinely means today");
});

test("the 16:00 ET boundary is the cash close, exactly", () => {
  assert.doesNotMatch(formatSessionCalendarBlock("2026-08-20", 3, 16 * 60 - 1), /EXPIRY STATUS/);
  assert.match(formatSessionCalendarBlock("2026-08-20", 3, 16 * 60), /EXPIRY STATUS/);
});

test("a NON-trading day is never marked settled", () => {
  // Saturday already reads "NOT a trading day". Telling someone their options "have settled" on a
  // Saturday would be a strange claim, and the existing line already covers it.
  const sat = formatSessionCalendarBlock("2026-08-22", 3, 18 * 60);
  assert.doesNotMatch(sat, /EXPIRY STATUS/);
  assert.match(sat, /NOT a trading day/);
});

test("omitting the time leaves the block byte-identical to before", () => {
  // Optional by design: every existing caller and test must be unaffected.
  assert.equal(formatSessionCalendarBlock("2026-08-20", 3), formatSessionCalendarBlock("2026-08-20", 3, undefined));
  assert.doesNotMatch(formatSessionCalendarBlock("2026-08-20", 3), /EXPIRY STATUS/);
});

test("the DATE RULE survives alongside the new status line", () => {
  const block = formatSessionCalendarBlock("2026-08-20", 3, 17 * 60);
  assert.match(block, /DATE RULE: the list above is authoritative/);
  assert.match(block, /Session date \(ET\): 2026-08-20/);
});
