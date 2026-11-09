import { test } from "node:test";
import assert from "node:assert/strict";
import { formatAdminUserDate } from "./admin-user-account-date";

// BUG THIS GUARDS (DISCOVERY-lane ET-anchoring sweep, round 514): formatAdminUserDate (inlined in
// UserManagement.tsx as `formatDate` before this fix) rendered the admin Users table's
// createdAt/lastSignInAt/lastActiveAt columns via `toLocaleDateString` with no `timeZone` option,
// so it rendered the VIEWER's browser-local calendar date rather than this product's one clock
// (US/Eastern — see et-clock.ts's module header, and the DarkPoolPanel/SignalAnalyticsPanel fixes
// for the same bug shape on this platform's trading desks). Picked so the UTC calendar date and
// the ET calendar date genuinely differ, not just the clock hour: 2026-01-16T03:15:00Z is Jan 16
// in UTC (this sandbox's default runtime zone) but still Jan 15 in America/New_York (EST, UTC-5
// in January) — the exact one-day drift an admin outside ET would have seen pre-fix.
test("formatAdminUserDate renders the account timestamp's ET calendar date, not the runtime's local one", () => {
  assert.equal(formatAdminUserDate(new Date("2026-01-16T03:15:00.000Z").getTime()), "Jan 15, 2026");
});

test("formatAdminUserDate still falls back to the em-dash for a falsy/zero timestamp", () => {
  assert.equal(formatAdminUserDate(0), "—");
});
