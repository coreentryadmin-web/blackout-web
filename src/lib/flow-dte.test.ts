import { test } from "node:test";
import assert from "node:assert/strict";
import { dteFromExpiry } from "./flow-dte";

/**
 * The bug this pins: `new Date("YYYY-MM-DD")` is UTC midnight, so between 20:00 and 24:00 ET the
 * UTC calendar date is already TOMORROW and a next-session expiry evaluated as 0DTE.
 *
 * 2026-08-24 is a Monday in EDT (UTC-4), so 20:00 ET = 2026-08-25T00:00Z — the UTC date has already
 * rolled while it is still Monday evening in New York.
 */
const at = (iso: string) => Date.parse(iso);

test("the 20:00-24:00 ET window: a NEXT-SESSION expiry is 1DTE, not 0DTE", () => {
  // 21:00 ET Monday 2026-08-24 == 2026-08-25T01:00Z. Expiry Tuesday 2026-08-25.
  const nowMs = at("2026-08-25T01:00:00Z");
  assert.equal(dteFromExpiry("2026-08-25", nowMs), 1, "tomorrow's expiry must be 1DTE, not 0");
  // The UTC-anchored form this replaced: ceil((expiry - now)/86400000) = ceil(-0.041) = -0 -> 0,
  // which routed the print "0dte" and handed it the +15 score bonus.
  const utcAnchored = Math.ceil((Date.parse("2026-08-25T00:00:00Z") - nowMs) / 86_400_000);
  // It returns NEGATIVE ZERO — `Math.ceil(-0.041)` is `-0`, which is why `assert.equal(x, 0)`
  // fails on it while `x <= 0` is true. Asserting the CONSEQUENCE rather than the literal, because
  // `dte <= 0` is what actually routes the print "0dte" and hands it the +15 score bonus, and -0
  // takes that branch exactly like 0 does.
  assert.ok(utcAnchored <= 0, "the old derivation took the 0DTE branch here — this is the bug");
  assert.ok(dteFromExpiry("2026-08-25", nowMs)! > 0, "the ET-anchored one does not");
});

test("the same instant reads TODAY's expiry as 0DTE", () => {
  const nowMs = at("2026-08-25T01:00:00Z"); // still Monday 2026-08-24 in ET
  assert.equal(dteFromExpiry("2026-08-24", nowMs), 0, "the session that has not closed is 0DTE");
  assert.equal(dteFromExpiry("2026-08-23", nowMs), -1, "an expired contract stays negative");
});

test("mid-session, where UTC and ET agree, the answer is unchanged", () => {
  // 14:00 ET == 18:00Z — same calendar date either way, so this is the no-op case that must not move.
  const nowMs = at("2026-08-24T18:00:00Z");
  assert.equal(dteFromExpiry("2026-08-24", nowMs), 0);
  assert.equal(dteFromExpiry("2026-08-25", nowMs), 1);
  assert.equal(dteFromExpiry("2026-08-31", nowMs), 7);
  assert.equal(dteFromExpiry("2026-09-23", nowMs), 30);
});

test("the early-morning ET window, where UTC is still the PREVIOUS day, is also correct", () => {
  // 00:30 ET Tuesday 2026-08-25 == 04:30Z the same day, so UTC and ET agree here; the mirror risk
  // is a derivation anchored the other way. Pinned so a future "fix" cannot introduce it.
  const nowMs = at("2026-08-25T04:30:00Z");
  assert.equal(dteFromExpiry("2026-08-25", nowMs), 0);
  assert.equal(dteFromExpiry("2026-08-26", nowMs), 1);
});

test("EST as well as EDT — the offset changes and the anchor must not", () => {
  // 2026-01-12 is a Monday in EST (UTC-5), so 20:00 ET = 2026-01-13T01:00Z.
  const nowMs = at("2026-01-13T01:00:00Z");
  assert.equal(dteFromExpiry("2026-01-13", nowMs), 1, "next session under EST is still 1DTE");
  assert.equal(dteFromExpiry("2026-01-12", nowMs), 0);
});

test("an unparseable or absent expiry is null, never a number", () => {
  const nowMs = at("2026-08-24T18:00:00Z");
  for (const bad of ["", "not-a-date", "2026-13-45", "20260824"]) {
    assert.equal(dteFromExpiry(bad, nowMs), null, `${JSON.stringify(bad)} must be null`);
  }
});

test("a full ISO timestamp is accepted, using its date part", () => {
  const nowMs = at("2026-08-24T18:00:00Z");
  assert.equal(dteFromExpiry("2026-08-26T00:00:00Z", nowMs), 2);
});
