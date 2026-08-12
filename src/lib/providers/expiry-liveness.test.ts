import test from "node:test";
import assert from "node:assert/strict";
import { isExpirySettled, liveExpiries } from "./expiry-liveness";

/**
 * The regression: on 2026-08-12 at 03:46 UTC (23:46 ET on the 11th, after that day's close), the
 * live SPY heatmap still listed `2026-08-11` first in both `expiries` and `near_term_expiries`. It
 * contributed zero gamma — a dead leftmost column — while its open interest still produced the
 * headline "MAX PAIN 771" from contracts that had already settled.
 */

// 23:46 ET on 2026-08-11 — the exact instant the bug was measured.
const AFTER_CLOSE = new Date("2026-08-12T03:46:00Z");
// 11:00 ET on 2026-08-11 — mid-session, when that same expiry is the 0DTE contract.
const DURING_RTH = new Date("2026-08-11T15:00:00Z");

test("today's expiry is DEAD after the 4pm ET close — the measured bug", () => {
  assert.equal(isExpirySettled("2026-08-11", AFTER_CLOSE), true);
});

test("today's expiry is LIVE during the session — dropping the 0DTE column would be worse", () => {
  assert.equal(isExpirySettled("2026-08-11", DURING_RTH), false);
});

test("a past expiry is dead at any hour", () => {
  assert.equal(isExpirySettled("2026-08-07", DURING_RTH), true);
  assert.equal(isExpirySettled("2026-08-07", AFTER_CLOSE), true);
});

test("a future expiry is live at any hour", () => {
  assert.equal(isExpirySettled("2026-08-12", AFTER_CLOSE), false);
  assert.equal(isExpirySettled("2027-01-15", DURING_RTH), false);
});

test("the boundary is the close itself, to the hour", () => {
  // 15:59 ET -> still live; 16:00 ET -> settled.
  assert.equal(isExpirySettled("2026-08-11", new Date("2026-08-11T19:59:00Z")), false);
  assert.equal(isExpirySettled("2026-08-11", new Date("2026-08-11T20:00:00Z")), true);
});

test("just after ET midnight is not mistaken for late afternoon", () => {
  // 00:30 ET on the 12th: hour renders as 24 in some ICU builds; if that leaked through, the 12th
  // would be declared settled the moment the day began.
  const justAfterMidnight = new Date("2026-08-12T04:30:00Z");
  assert.equal(isExpirySettled("2026-08-12", justAfterMidnight), false);
});

test("liveExpiries drops the settled front and keeps order", () => {
  const axis = ["2026-08-11", "2026-08-12", "2026-08-13", "2026-08-14"];
  assert.deepEqual(liveExpiries(axis, AFTER_CLOSE), ["2026-08-12", "2026-08-13", "2026-08-14"]);
  // During RTH the same axis is untouched — the front expiry is the 0DTE board.
  assert.deepEqual(liveExpiries(axis, DURING_RTH), axis);
});

test("an all-settled axis is returned UNCHANGED rather than emptied", () => {
  // A board with no columns is worse than a stale one, and an empty result would also hide that
  // the provider is serving nothing current.
  const stale = ["2026-08-03", "2026-08-04"];
  assert.deepEqual(liveExpiries(stale, AFTER_CLOSE), stale);
});

test("a malformed expiry is treated as LIVE, never silently dropped", () => {
  assert.equal(isExpirySettled("", AFTER_CLOSE), false);
  assert.equal(isExpirySettled("not-a-date", AFTER_CLOSE), false);
  assert.deepEqual(liveExpiries(["garbage", "2026-08-11"], AFTER_CLOSE), ["garbage"]);
});

test("a full ISO timestamp is accepted, not just a bare date", () => {
  assert.equal(isExpirySettled("2026-08-11T00:00:00Z", AFTER_CLOSE), true);
});
