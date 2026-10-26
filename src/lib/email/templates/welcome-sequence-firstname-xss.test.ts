import assert from "node:assert/strict";
import { test } from "node:test";
import { WELCOME_SEQUENCE } from "./welcome-sequence.ts";

// Regression: welcome-sequence.ts's own `personalize()` substitutes {{firstName}} via a bare
// `text.replace(/\{\{firstName\}\}/g, name)` — unlike every sibling billing-lifecycle template
// (welcome-premium.ts, downgrade.ts, scheduled-cancel.ts, payment-failed.ts, access-ended.ts,
// welcome-community.ts, cancel-reversed.ts, trial-ending-soon.ts), which all route firstName
// through layout.ts's `substituteTokens` (HTML-escaped by design — see layout.test.ts's own
// "escapes HTML-significant characters" coverage for the exact same token). `firstName` here
// comes straight off the Clerk user.created webhook's `data.first_name` — a member's own
// self-settable Clerk profile field (src/app/api/webhooks/clerk/route.ts) — reaching every one
// of this 5-step drip's HTML bodies unescaped. A member who sets their Clerk first name to
// `<script>...</script>` or an `onerror=` payload gets exactly that markup rendered live in the
// welcome email this cron fires straight off signup (self-XSS in an email client that executes
// it, same risk class layout.ts's own comment names for this exact field). Every one of the 5
// steps is checked, not just step 1, since each has its own `build()` closure.
test("welcome-sequence personalize() escapes HTML-significant characters in firstName (all 5 steps)", () => {
  const payload = `<script>alert('x')</script>`;
  for (const step of WELCOME_SEQUENCE) {
    const { html, subject } = step.build({ email: "member@example.com", firstName: payload });
    assert.ok(
      !html.includes("<script>"),
      `step ${step.step}: raw <script> tag from firstName must not survive into the email HTML`
    );
    assert.ok(
      !subject.includes("<script>"),
      `step ${step.step}: raw <script> tag from firstName must not survive into the subject`
    );
  }
});

test("welcome-sequence personalize() escapes an onerror= attribute injection attempt", () => {
  const payload = `"><img src=x onerror=alert(1)>`;
  const step1 = WELCOME_SEQUENCE.find((s) => s.step === 1);
  assert.ok(step1, "step 1 not found");
  const { html } = step1!.build({ email: "member@example.com", firstName: payload });
  assert.ok(!html.includes("<img src=x onerror=alert(1)>"), "raw onerror= markup must not survive");
});

test("welcome-sequence personalize() leaves a plain display name unchanged", () => {
  const step1 = WELCOME_SEQUENCE.find((s) => s.step === 1);
  assert.ok(step1, "step 1 not found");
  const { html, subject } = step1!.build({ email: "member@example.com", firstName: "Alex" });
  assert.match(html, /Alex, that's what actually moves the candle/);
  assert.match(subject, /^Alex, you're in\. The desk is live\.$/);
});
