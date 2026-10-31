import assert from "node:assert/strict";
import { test } from "node:test";
import { accessEndedEmail } from "./access-ended.ts";

// Regression for a live bug: accessEndedEmail's closing re-engagement line names the two
// doors back — "SPX Slayer for the 0DTE desk, Premium for the full six-engine stack" — but
// Premium is the 0DTE desk PLUS the other six engines (Thermal, HELIX, Night Hawk, Largo AI,
// Vector, Meridian): SEVEN products total, exactly as welcomePremiumEmail states it ("All
// seven products, live." / "full seven-product desk, no walls between you and any of it") and
// as this very file's own top-of-function comment says ("a Premium member loses the whole
// seven-product desk"). "six-engine stack" undercounts Premium's real entitlement by one and
// breaks the established naming convention every sibling lifecycle template follows: "six"
// always names the six OTHER engines beyond the 0DTE desk a member already has (welcome-
// premium.ts's "six more engines", downgrade.ts's "six engines went dark", scheduled-
// cancel.ts's "those six engines"), never the whole Premium stack INCLUDING the 0DTE desk
// itself — that whole stack is always "seven". Same bug class as
// welcome-premium-downgrade-product-count.test.ts (stale engine counts left behind when
// Meridian shipped as the 7th product). This closing paragraph is NOT gated by
// `previousTier` — it renders identically for a Premium or a community cancellation — so the
// undercount reached every full-cancellation email regardless of which tier the member left.
test("accessEndedEmail: the re-engagement line calls Premium the full seven-engine stack, not six", () => {
  const { html } = accessEndedEmail({ firstName: "Alex", previousTier: "premium" });
  assert.match(html, /Premium for the full seven-engine stack/);
  assert.doesNotMatch(html, /full six-engine stack/);
});

test("accessEndedEmail: the same (shared, not tier-gated) re-engagement line is correct for a community cancellation too", () => {
  const { html } = accessEndedEmail({ firstName: "Alex", previousTier: "community" });
  assert.match(html, /Premium for the full seven-engine stack/);
  assert.doesNotMatch(html, /full six-engine stack/);
});
