import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildCancellationNotificationBody,
  shouldNotifyCancellation,
} from "./whop-cancellation-notify.ts";

test("shouldNotifyCancellation fires only on a NEW cancellation (cancel_at_period_end true)", () => {
  assert.equal(shouldNotifyCancellation("membership.cancel_at_period_end_changed", true), true);
});

test("shouldNotifyCancellation does not fire on a reactivation (flips back to false)", () => {
  assert.equal(shouldNotifyCancellation("membership.cancel_at_period_end_changed", false), false);
});

test("shouldNotifyCancellation does not fire on unrelated event types even if the flag is true", () => {
  assert.equal(shouldNotifyCancellation("membership.activated", true), false);
  assert.equal(shouldNotifyCancellation("membership.deactivated", true), false);
});

test("shouldNotifyCancellation does not fire when the flag is null/undefined (unknown state)", () => {
  assert.equal(shouldNotifyCancellation("membership.cancel_at_period_end_changed", null), false);
  assert.equal(shouldNotifyCancellation("membership.cancel_at_period_end_changed", undefined), false);
});

test("buildCancellationNotificationBody includes email, reason label, and free-text reason", () => {
  const body = buildCancellationNotificationBody({
    email: "trader@example.com",
    whopUserId: "user_whop_1",
    cancelOption: "too_expensive",
    cancellationReason: "Just not trading enough right now",
  });
  assert.match(body, /trader@example\.com/);
  assert.match(body, /too_expensive/);
  assert.match(body, /Just not trading enough right now/);
});

test("buildCancellationNotificationBody falls back to whopUserId when email is missing", () => {
  const body = buildCancellationNotificationBody({
    email: null,
    whopUserId: "user_whop_2",
    cancelOption: "switching",
    cancellationReason: null,
  });
  assert.match(body, /user_whop_2/);
  assert.match(body, /switching/);
});

test("buildCancellationNotificationBody handles no reason given at all", () => {
  const body = buildCancellationNotificationBody({
    email: null,
    whopUserId: null,
    cancelOption: null,
    cancellationReason: null,
  });
  assert.match(body, /unknown member/);
  assert.match(body, /no_reason_given/);
});

test("buildCancellationNotificationBody trims whitespace-only free text to nothing", () => {
  const body = buildCancellationNotificationBody({
    email: "trader@example.com",
    whopUserId: null,
    cancelOption: "other",
    cancellationReason: "   ",
  });
  assert.doesNotMatch(body, /—\s*"/, "whitespace-only reason should not render an empty quoted string");
});

// SECURITY regression: cancellationReason is Whop's own free-text survey field, typed by the
// cancelling member and delivered unreviewed into the ops Discord channel. Without escaping,
// Discord markdown control characters in that text render as live formatting in that channel.
test("buildCancellationNotificationBody escapes Discord markdown in the free-text reason", () => {
  const body = buildCancellationNotificationBody({
    email: "trader@example.com",
    whopUserId: null,
    cancelOption: "other",
    cancellationReason: "**fake alert** _click here_ `code` > not a quote [link](https://evil.example)",
  });
  // Every markdown control character in the free text must be backslash-escaped, so Discord
  // renders it as literal text rather than formatting/a masked link.
  assert.match(body, /\\\*\\\*fake alert\\\*\\\*/);
  assert.match(body, /\\_click here\\_/);
  assert.match(body, /\\`code\\`/);
  assert.match(body, /\\>/);
  assert.match(body, /\\\[link\\]\(https:\/\/evil\.example\)/);
  // The raw, unescaped forms must not survive into the rendered body.
  assert.doesNotMatch(body, /\*\*fake alert\*\*/);
  assert.doesNotMatch(body, /\[link\]\(https:\/\/evil\.example\)/);
});

test("buildCancellationNotificationBody escapes Discord markdown in an attacker-controlled email local-part", () => {
  const body = buildCancellationNotificationBody({
    email: "[Verify your billing](https://evil.example/phish)@example.com",
    whopUserId: null,
    cancelOption: "too_expensive",
    cancellationReason: null,
  });
  assert.doesNotMatch(
    body,
    /\[Verify your billing\]\(https:\/\/evil\.example\/phish\)@example\.com/,
    "a masked-link-shaped email local-part must not survive unescaped"
  );
  assert.match(body, /\\\[Verify your billing\\\]/);
});
