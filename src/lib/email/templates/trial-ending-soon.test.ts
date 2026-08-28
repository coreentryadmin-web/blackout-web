import assert from "node:assert/strict";
import { test } from "node:test";
import { formatTrialEndLabel, trialEndingSoonEmail } from "./trial-ending-soon.ts";

test("formatTrialEndLabel: formats valid ISO in ET", () => {
  const label = formatTrialEndLabel("2026-09-01T12:00:00.000Z");
  assert.match(label, /Sep/);
  assert.match(label, /1/);
});

test("formatTrialEndLabel: null/invalid → soon", () => {
  assert.equal(formatTrialEndLabel(null), "soon");
  assert.equal(formatTrialEndLabel("not-a-date"), "soon");
});

test("trialEndingSoonEmail: renders plan label + CTA", () => {
  const { subject, html } = trialEndingSoonEmail({
    firstName: "Alex",
    billingKind: "premium",
    trialEndsLabel: "Monday, Sep 1",
  });
  assert.match(subject, /Premium/);
  assert.match(html, /Monday, Sep 1/);
  assert.match(html, /\/account/);
});
