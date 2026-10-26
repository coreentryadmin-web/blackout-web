import assert from "node:assert/strict";
import { test } from "node:test";
import { accessEndedEmail } from "./access-ended.ts";

// Regression for a live bug (round 106): AccessEndedContext accepted `previousTier` (and
// billing-lifecycle-email.ts's dispatchTransitionEmail has always passed the real previous
// tier — "premium" or "community" — through to it) but the template body never read the
// field. A full cancellation reaches this email from either paid tier, yet every send used
// identical, community-shaped wording that only ever mentioned the 0DTE desk — a Premium
// member losing the other six engines (Thermal, HELIX, Night Hawk, Largo AI, Vector,
// Meridian) alongside it was never told so. Same "email copy doesn't match the recipient's
// real tier/entitlements" bug class already fixed in welcomePremiumEmail's dual-opener and
// downgradeEmail's explicit six-engine list.
test("accessEndedEmail: a Premium cancellation names the other six engines lost alongside the 0DTE desk", () => {
  const { html } = accessEndedEmail({ firstName: "Alex", previousTier: "premium" });
  for (const engine of ["Thermal", "HELIX", "Night Hawk", "Largo AI", "Vector", "Meridian"]) {
    assert.match(html, new RegExp(engine), `expected Premium cancellation copy to name ${engine}`);
  }
});

test("accessEndedEmail: a community (SPX Slayer) cancellation does NOT falsely claim the other six engines were lost", () => {
  const { html } = accessEndedEmail({ firstName: "Alex", previousTier: "community" });
  for (const engine of ["Thermal", "HELIX", "Largo AI", "Meridian"]) {
    assert.doesNotMatch(html, new RegExp(engine), `community cancellation never had ${engine} to lose`);
  }
});

test("accessEndedEmail: Premium and community cancellations render genuinely different opening copy", () => {
  const premium = accessEndedEmail({ firstName: "Alex", previousTier: "premium" }).html;
  const community = accessEndedEmail({ firstName: "Alex", previousTier: "community" }).html;
  assert.notStrictEqual(premium, community);
});
