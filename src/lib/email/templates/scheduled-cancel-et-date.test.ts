import assert from "node:assert/strict";
import { test } from "node:test";
import { scheduledCancelEmail } from "./scheduled-cancel.ts";

// Regression: `formatDate` inside scheduled-cancel.ts rendered `accessUntil` (an absolute
// instant -- the webhook route builds it straight from Whop's `renewal_period_end`, see
// src/app/api/webhook/whop/route.ts) via `toLocaleDateString("en-US", {...})` with NO
// `timeZone` option. That defaults to the server process's local timezone -- UTC in
// production (node:20-bookworm-slim) and in this sandbox alike -- not this product's one
// clock, America/New_York (see et-clock.ts's header, and the sibling trial-ending-soon.ts's
// `formatTrialEndLabel`, which pins `timeZone: "America/New_York"` for the SAME
// `renewal_period_end` field and is explicitly commented "(America/New_York date)").
//
// Concretely: 2026-12-01T02:00:00Z is 2026-11-30 21:00 ET (EST, UTC-5) -- still November 30
// in New York. Rendered in UTC (the unpinned default) it reads "December 1, 2026", a full
// calendar day ahead of the real ET date. A member canceling late in the ET day, whose
// period ends in that window, would be told their access runs through the WRONG day in the
// cancellation-confirmation email -- the exact bug shape already fixed in
// admin-user-account-date.ts / DarkPoolPanel (#7824) / SignalAnalyticsPanel (#7826), just in
// this sibling billing-lifecycle template.
test("scheduledCancelEmail: accessUntil date is anchored to America/New_York, not server-local UTC", () => {
  const accessUntil = new Date("2026-12-01T02:00:00Z"); // 2026-11-30 21:00 ET
  const { subject, html } = scheduledCancelEmail({ firstName: "Alex", accessUntil });

  assert.match(subject, /November 30, 2026/, `expected ET-anchored date in subject, got: ${subject}`);
  assert.doesNotMatch(subject, /December 1, 2026/, `subject rendered the wrong (UTC) calendar day: ${subject}`);
  assert.match(html, /November 30, 2026/, "expected ET-anchored date in email body");
});
