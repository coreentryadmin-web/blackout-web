import assert from "node:assert/strict";
import { test } from "node:test";
import { welcomePremiumEmail } from "./welcome-premium.ts";
import { downgradeEmail } from "./downgrade.ts";

// Regression for a live bug (2026-10-11): Meridian shipped as the 7th live product
// (commit 5103e7f8d bumped the subject/opener/closing-paragraph counts in
// welcome-premium.ts from six->seven, and downgrade.ts's own body paragraph from
// five->six), but each template's PREHEADER — and downgrade.ts's doc comment — were
// never updated to match, leaving stale "five more engines"/"five engines" strings
// that directly contradicted the "six"/"seven" language in the same file. A member
// would see one count in their inbox preview and a different one once the email
// opened.

test("welcomePremiumEmail: preheader names Meridian and agrees with the six-more-engines body copy", () => {
  const { html } = welcomePremiumEmail({ firstName: "Alex", previousTier: "free", billingInterval: "monthly" });
  // The preheader lives inside emailLayout's hidden preview text, not the visible subject.
  assert.match(html, /Meridian/);
  assert.match(html, /six more engines/);
  assert.doesNotMatch(html, /five more engines/);
});

test("welcomePremiumEmail: sharedParagraphs body copy describes Meridian alongside the other five engines", () => {
  const { html } = welcomePremiumEmail({ firstName: "Alex", previousTier: "community", billingInterval: "yearly" });
  assert.match(html, /Meridian tracks the catalyst calendar/);
});

test("downgradeEmail: preheader agrees with the body's six-products count", () => {
  const { html } = downgradeEmail({ firstName: "Alex" });
  assert.match(html, /Six products, off your account/);
  assert.match(html, /six engines went dark/);
  assert.doesNotMatch(html, /five engines went dark/);
});
