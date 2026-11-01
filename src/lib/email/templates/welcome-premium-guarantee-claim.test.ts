import assert from "node:assert/strict";
import { test } from "node:test";
import { welcomePremiumEmail } from "./welcome-premium.ts";

// Regression (2026-11-01): welcomePremiumEmail is dispatched from
// billing-lifecycle-email.ts's dispatchTransitionEmail() the moment Whop's
// `membership.activated` webhook fires for a brand-new or upgraded Premium
// subscription — i.e. at the very start of that subscription's life, not
// days into it (see billing-lifecycle-email.ts's dispatchTransitionEmail and
// the real-time-only doc comment on syncWhopMembershipAndNotify).
//
// For a yearly billingInterval, the annual-guarantee paragraph nonetheless
// told every new annual subscriber "the 7-day guarantee's already come and
// gone, satisfied" — a false statement at send time. The refund policy
// (src/app/(marketing)/refund-policy/page.tsx: "Annual subscriptions are
// non-refundable after the first 7 days... refund... After the 7-day
// window...") makes the window run FROM the subscription date, so on the
// email that fires AT that date the window has just opened, not closed. A
// member reading this on day one could reasonably conclude they'd already
// forfeited a refund right they in fact still had for the next week.
test("welcomePremiumEmail: yearly annual-guarantee line does not claim the 7-day window already elapsed", () => {
  const { html } = welcomePremiumEmail({ firstName: "Alex", previousTier: "free", billingInterval: "yearly" });
  assert.doesNotMatch(html, /guarantee's already come and gone/);
  assert.doesNotMatch(html, /already come and gone, satisfied/);
  // The guarantee must still read as live/available, not settled.
  assert.match(html, /7-day money-back guarantee/);
});

test("welcomePremiumEmail: monthly billingInterval renders no annual-guarantee line at all", () => {
  const { html } = welcomePremiumEmail({ firstName: "Alex", previousTier: "free", billingInterval: "monthly" });
  assert.doesNotMatch(html, /guarantee/i);
});
