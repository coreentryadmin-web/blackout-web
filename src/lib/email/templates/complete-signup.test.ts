import assert from "node:assert/strict";
import { test } from "node:test";
import { completeSignupEmail } from "./complete-signup.ts";

test("premium: subject and body name the right plan and the paid email", () => {
  const { subject, html } = completeSignupEmail({ email: "trader@example.com", billingKind: "premium" });
  assert.match(subject, /Premium/);
  assert.match(html, /trader@example\.com/);
  assert.match(html, /Premium/);
});

test("community: subject and body name SPX Slayer, not the raw billing-kind string", () => {
  const { subject, html } = completeSignupEmail({ email: "trader@example.com", billingKind: "community" });
  assert.match(subject, /SPX Slayer/);
  assert.match(html, /SPX Slayer/);
  assert.ok(!/community/i.test(subject), "must not leak the internal billingKind string into the subject");
});

test("CTA points at sign-up, not sign-in — this member has no account yet", () => {
  const { html } = completeSignupEmail({ email: "trader@example.com", billingKind: "premium" });
  assert.match(html, /\/sign-up/);
});
