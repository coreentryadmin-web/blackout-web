import assert from "node:assert/strict";
import { test } from "node:test";
import { buildNewMemberNotificationBody } from "./clerk-new-member-notify.ts";

test("includes email and full name when both are present", () => {
  const body = buildNewMemberNotificationBody({
    email: "trader@example.com",
    firstName: "Jamie",
    lastName: "Ellis",
    clerkUserId: "user_123",
  });
  assert.match(body, /trader@example\.com/);
  assert.match(body, /Jamie Ellis/);
  assert.match(body, /clerk_user_id=user_123/);
});

test("falls back to a placeholder when email is missing rather than printing 'null'", () => {
  const body = buildNewMemberNotificationBody({
    email: null,
    firstName: null,
    lastName: null,
    clerkUserId: "user_456",
  });
  assert.match(body, /no email on account/);
  assert.ok(!body.includes("null"), "must never leak a literal 'null' into the ops message");
});

test("omits the name segment entirely when no name is on file, rather than a stray dash", () => {
  const body = buildNewMemberNotificationBody({
    email: "solo@example.com",
    firstName: null,
    lastName: null,
    clerkUserId: "user_789",
  });
  assert.equal(body, "solo@example.com · clerk_user_id=user_789");
});

test("a first name with no last name (or vice versa) doesn't leave a dangling space", () => {
  const onlyFirst = buildNewMemberNotificationBody({
    email: "a@example.com",
    firstName: "Sam",
    lastName: null,
    clerkUserId: "user_1",
  });
  assert.equal(onlyFirst, "a@example.com — Sam · clerk_user_id=user_1");

  const onlyLast = buildNewMemberNotificationBody({
    email: "b@example.com",
    firstName: null,
    lastName: "Lee",
    clerkUserId: "user_2",
  });
  assert.equal(onlyLast, "b@example.com — Lee · clerk_user_id=user_2");
});
