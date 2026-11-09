import assert from "node:assert/strict";
import { test } from "node:test";
import { fmtShares, fmtDate } from "./DarkPoolPanel";

test("fmtShares formats under 1K and under 1M plainly", () => {
  assert.equal(fmtShares(500), "500");
  assert.equal(fmtShares(125_000), "125K");
});

test("fmtShares promotes a share count that rounds to 1000K into 1.0M, never an overflowed label", () => {
  assert.equal(fmtShares(999_600), "1.0M");
  assert.equal(fmtShares(999_999), "1.0M");
  assert.equal(fmtShares(999_499), "999K");
});

// BUG THIS GUARDS: fmtDate used to read the Date object's LOCAL getters
// (getMonth/getDate/getHours/getMinutes) — the host/browser timezone — instead of anchoring to
// America/New_York like every other absolute timestamp on this desk (fmtFullTimestamp,
// helix-flow-format.ts). Picked so the UTC calendar date and the ET calendar date genuinely
// differ, which is the part a naive host-timezone read gets wrong, not just the clock hour:
// 2026-01-16T03:15:00Z is 03:15 UTC on Jan 16, but 22:15 ET on Jan 15 (EST, UTC-5 in January).
// A fix that merely shifted the HOUR without anchoring the DATE itself would still fail this.
test("fmtDate renders the print's ET date/time, not the runtime's local one — even across a UTC/ET date-boundary crossing", () => {
  assert.equal(fmtDate("2026-01-16T03:15:00.000Z"), "01/15 22:15");
});

test("fmtDate normalizes ET midnight (hourCycle '24') to '00', same as fmtFullTimestamp", () => {
  // 2026-01-16T05:00:00Z is exactly 00:00 ET (EST, UTC-5) on 2026-01-16.
  assert.equal(fmtDate("2026-01-16T05:00:00.000Z"), "01/16 00:00");
});

test("fmtDate still falls back to timeAgo's dash for an absent/invalid timestamp", () => {
  assert.equal(fmtDate(null), "—");
  assert.equal(fmtDate(""), "—");
  assert.equal(fmtDate("not-a-date"), "—");
});
