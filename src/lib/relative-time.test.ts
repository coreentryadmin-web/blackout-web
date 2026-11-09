import { test } from "node:test";
import assert from "node:assert/strict";

import { relativeAge, shortMonthDay } from "./relative-time";

test("relativeAge returns fallback for null/undefined/empty/unparseable — never NaN", () => {
  assert.equal(relativeAge(null), "—");
  assert.equal(relativeAge(undefined), "—");
  assert.equal(relativeAge(""), "—");
  assert.equal(relativeAge("not-a-date"), "—");
  assert.equal(relativeAge(NaN), "—");
  // The exact bug: an unguarded formatter emitted "NaNh ago" for these.
  assert.equal(relativeAge(null, { suffix: true }), "—");
  assert.equal(relativeAge("garbage", { suffix: true }), "—");
  assert.equal(relativeAge(null, { fallback: "just now" }), "just now");
});

test("relativeAge formats valid instants, with and without suffix", () => {
  const now = Date.now();
  assert.equal(relativeAge(new Date(now - 5_000)), "5s");
  assert.equal(relativeAge(new Date(now - 5 * 60_000), { suffix: true }), "5m ago");
  assert.equal(relativeAge(new Date(now - 3 * 3_600_000)), "3h");
  assert.equal(relativeAge(new Date(now - 3 * 86_400_000), { suffix: true }), "3d ago");
  // Future timestamp clamps to 0s, never a negative age.
  assert.equal(relativeAge(new Date(now + 60_000)), "0s");
});

test("shortMonthDay guards bad input and formats YMD + ISO", () => {
  assert.equal(shortMonthDay(null), "—");
  assert.equal(shortMonthDay(undefined), "—");
  assert.equal(shortMonthDay(""), "—");
  assert.equal(shortMonthDay("Invalid"), "—");
  assert.equal(shortMonthDay("2026-07-13"), "7/13");
  assert.equal(shortMonthDay("2026-12-05"), "12/5");
  assert.equal(shortMonthDay("2026-07-13T09:30:00-04:00"), "7/13");
});

test("shortMonthDay anchors an ISO instant to ET, not the viewer's local zone", () => {
  // Same bug class as #7824/#7826: a formatter with no `timeZone` renders in whatever zone the
  // VIEWER's browser is set to. `2026-07-13T09:30:00-04:00` is 7/13 in ET (its own offset) and
  // also 7/13 UTC — but it is already 7/14 in Auckland (UTC+12 in July, NZST) and still 7/12 in
  // Honolulu (UTC-10) is NOT crossed here; pick zones on both sides of ET to prove the pin, not
  // just one. Before the fix (no `timeZone` on the instant branch), this test fails under both
  // zones because the viewer's local day differs from the ET day; after the fix it passes under
  // every zone because the render is pinned to America/New_York regardless of `process.env.TZ`.
  const originalTz = process.env.TZ;
  try {
    process.env.TZ = "Pacific/Auckland"; // UTC+12 — one calendar day AHEAD of ET in July
    assert.equal(shortMonthDay("2026-07-13T09:30:00-04:00"), "7/13");
    process.env.TZ = "Pacific/Honolulu"; // UTC-10 — one calendar day BEHIND ET for a late instant
    assert.equal(shortMonthDay("2026-07-13T23:30:00-04:00"), "7/13");
  } finally {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  }
});
