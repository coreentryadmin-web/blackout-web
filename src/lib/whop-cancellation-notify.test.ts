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
