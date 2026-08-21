import { test } from "node:test";
import assert from "node:assert/strict";

import {
  asPublishableSession,
  newestPublishableSession,
  publishableSessions,
  retainPublishable,
} from "./publishable-session";

// Real 2026 dates. 2026-08-21 is a Friday; 2026-08-22/23 are the weekend.
// 2026-07-03 is the observed Independence Day holiday (NYSE closed).

test("the newest publishable session is always STRICTLY before today", () => {
  // Mid-week: yesterday.
  assert.equal(newestPublishableSession("2026-08-20"), "2026-08-19");
  // Monday: the prior Friday, not the weekend.
  assert.equal(newestPublishableSession("2026-08-24"), "2026-08-21");
  // Sunday: still the prior Friday.
  assert.equal(newestPublishableSession("2026-08-23"), "2026-08-21");
});

test("today's session is never publishable — the whole point of the cutoff", () => {
  // A trading day, asked for itself. Even after the close this must refuse: the rule is a date
  // comparison precisely so no clock reading can ever admit an open session.
  assert.equal(asPublishableSession("2026-08-20", "2026-08-20"), null);
  // And the day before it is fine.
  assert.equal(asPublishableSession("2026-08-19", "2026-08-20"), "2026-08-19");
});

test("a future session is refused", () => {
  assert.equal(asPublishableSession("2026-09-15", "2026-08-20"), null);
});

test("non-trading days are refused even when safely in the past", () => {
  assert.equal(asPublishableSession("2026-08-22", "2026-08-27"), null, "Saturday");
  assert.equal(asPublishableSession("2026-08-23", "2026-08-27"), null, "Sunday");
  assert.equal(asPublishableSession("2026-07-03", "2026-08-27"), null, "NYSE holiday");
});

test("malformed input is rejected rather than coerced", () => {
  for (const bad of [null, undefined, 42, "", "2026-8-3", "yesterday", "2026-08-20T00:00:00Z", {}]) {
    assert.equal(asPublishableSession(bad, "2026-08-27"), null, `rejected: ${String(bad)}`);
  }
});

test("a session window walks the trading calendar, not the wall calendar", () => {
  // From Monday 2026-08-24, five sessions back is the previous full week — no weekend dates.
  const got = publishableSessions(5, "2026-08-24");
  assert.deepEqual(got, ["2026-08-21", "2026-08-20", "2026-08-19", "2026-08-18", "2026-08-17"]);
  assert.equal(got.length, 5, "five SESSIONS, not five calendar days");
});

test("a window spanning a holiday still yields that many real sessions", () => {
  const got = publishableSessions(4, "2026-07-07");
  // 2026-07-03 (holiday) and the 4th/5th (weekend) are all skipped.
  assert.ok(!got.includes("2026-07-03" as string), "the holiday is not a session");
  assert.equal(got.length, 4);
  assert.equal(new Set(got).size, 4, "no duplicates — the walk always advances");
  for (const s of got) assert.ok(s < "2026-07-07", `${s} must precede today`);
});

test("a window is strictly descending and never reaches today", () => {
  const got = publishableSessions(30, "2026-08-20");
  assert.equal(got.length, 30);
  for (let i = 1; i < got.length; i += 1) {
    assert.ok(got[i] < got[i - 1], `${got[i]} must be older than ${got[i - 1]}`);
  }
  assert.ok(got[0] < "2026-08-20");
});

test("a nonsense window size yields nothing rather than looping", () => {
  for (const n of [0, -5, NaN, Infinity]) {
    assert.deepEqual(publishableSessions(n, "2026-08-20"), []);
  }
});

test("retainPublishable drops rows a widened query let through", () => {
  const rows = [
    { session: "2026-08-19", v: 1 },
    { session: "2026-08-20", v: 2 }, // today — must not survive
    { session: "2026-08-21", v: 3 }, // tomorrow — must not survive
    { session: "not-a-date", v: 4 },
  ];
  assert.deepEqual(retainPublishable(rows, "2026-08-20"), [{ session: "2026-08-19", v: 1 }]);
});
