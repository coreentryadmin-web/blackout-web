import assert from "node:assert/strict";
import { test } from "node:test";
import { buildNewMemberNotificationFields } from "./clerk-new-member-notify.ts";

test("includes Email, Name, and Clerk User ID fields when a full name is present", () => {
  const fields = buildNewMemberNotificationFields({
    email: "trader@example.com",
    firstName: "Jamie",
    lastName: "Ellis",
    clerkUserId: "user_123",
  });
  assert.deepEqual(fields, [
    { name: "Email", value: "trader@example.com" },
    { name: "Name", value: "Jamie Ellis" },
    { name: "Clerk User ID", value: "`user_123`" },
  ]);
});

test("falls back to a placeholder when email is missing rather than printing 'null'", () => {
  const fields = buildNewMemberNotificationFields({
    email: null,
    firstName: null,
    lastName: null,
    clerkUserId: "user_456",
  });
  const emailField = fields.find((f) => f.name === "Email");
  assert.equal(emailField?.value, "*no email on account*");
  assert.ok(
    !fields.some((f) => f.value.includes("null")),
    "must never leak a literal 'null' into the ops message"
  );
});

test("omits the Name field entirely when no name is on file", () => {
  const fields = buildNewMemberNotificationFields({
    email: "solo@example.com",
    firstName: null,
    lastName: null,
    clerkUserId: "user_789",
  });
  assert.deepEqual(fields, [
    { name: "Email", value: "solo@example.com" },
    { name: "Clerk User ID", value: "`user_789`" },
  ]);
});

test("a first name with no last name (or vice versa) doesn't leave a dangling space", () => {
  const onlyFirst = buildNewMemberNotificationFields({
    email: "a@example.com",
    firstName: "Sam",
    lastName: null,
    clerkUserId: "user_1",
  });
  assert.equal(onlyFirst.find((f) => f.name === "Name")?.value, "Sam");

  const onlyLast = buildNewMemberNotificationFields({
    email: "b@example.com",
    firstName: null,
    lastName: "Lee",
    clerkUserId: "user_2",
  });
  assert.equal(onlyLast.find((f) => f.name === "Name")?.value, "Lee");
});
