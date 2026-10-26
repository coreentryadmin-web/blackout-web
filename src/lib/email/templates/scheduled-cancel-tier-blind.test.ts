import assert from "node:assert/strict";
import { test } from "node:test";
import { scheduledCancelEmail } from "./scheduled-cancel.ts";

// Regression for a live bug (found 2026-10-26, Round 105 audit sweep): scheduledCancelEmail's
// "stay live" paragraph hardcoded ALL SEVEN engine names — "SPX Slayer, Thermal, HELIX,
// Night Hawk, Largo AI, Vector, Meridian" — regardless of which plan the member actually pays
// for. membership.cancel_at_period_end_changed (src/app/api/webhook/whop/route.ts) fires this
// email for BOTH billing kinds, so a community ($49/mo, SPX Slayer ONLY) member scheduling a
// cancellation was told "every engine you're paying for stays live" immediately followed by six
// engine names — Thermal, HELIX, Night Hawk, Largo AI, Vector, Meridian — they never had access
// to and were never paying for. That's not reassuring, it's false: it either implies they're
// about to lose something they thought they had, or that they always had free access to six
// $199/mo-tier products. Fixed by threading the real billingKind (already resolved by the
// webhook route's own syncWhopMembershipForEmail call, one scope up) through
// notifyScheduledCancellation -> scheduledCancelEmail, so a community cancellation names only
// SPX Slayer while a premium one keeps the full seven-engine list.
test("scheduledCancelEmail: community billingKind names ONLY SPX Slayer, not the six premium-only engines", () => {
  const { html } = scheduledCancelEmail({
    firstName: "Alex",
    accessUntil: new Date("2026-11-01"),
    billingKind: "community",
  });
  assert.match(html, /SPX Slayer/);
  for (const premiumOnlyEngine of ["Thermal", "HELIX", "Night Hawk", "Largo AI", "Vector", "Meridian"]) {
    assert.doesNotMatch(
      html,
      new RegExp(premiumOnlyEngine),
      `community-tier cancellation email must not claim ${premiumOnlyEngine} "stays live" — they never had it`
    );
  }
});

test("scheduledCancelEmail: premium billingKind still names all seven live products", () => {
  const { html } = scheduledCancelEmail({
    firstName: "Alex",
    accessUntil: new Date("2026-11-01"),
    billingKind: "premium",
  });
  for (const engine of ["SPX Slayer", "Thermal", "HELIX", "Night Hawk", "Largo AI", "Vector", "Meridian"]) {
    assert.match(html, new RegExp(engine), `expected premium engine list to include ${engine}`);
  }
});

test("scheduledCancelEmail: omitted billingKind defaults to the full (premium) list — backward compatible", () => {
  const { html } = scheduledCancelEmail({ firstName: "Alex", accessUntil: new Date("2026-11-01") });
  assert.match(html, /Meridian/);
});
