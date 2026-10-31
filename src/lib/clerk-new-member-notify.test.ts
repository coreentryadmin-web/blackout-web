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

// SECURITY (2026-10-26): Discord embeds render Markdown INSIDE field values, including
// `[label](url)` masked links — a surface plain message `content` does not have. firstName/
// lastName are fully attacker-controlled at Clerk sign-up, and the ops webhook fires before any
// human reviews the account, so an unescaped value becomes a live clickable link (or bold/code/
// quote formatting) in the internal ops Discord channel the instant someone signs up.
test("a masked-link firstName renders as literal text, never a clickable Discord link", () => {
  const fields = buildNewMemberNotificationFields({
    email: "trader@example.com",
    firstName: "[Verify your billing](https://evil.example/phish)",
    lastName: null,
    clerkUserId: "user_evil",
  });
  const nameValue = fields.find((f) => f.name === "Name")?.value ?? "";
  // The raw, unescaped markdown link syntax must never survive intact — every bracket/paren
  // character Discord's masked-link syntax depends on must be backslash-escaped.
  assert.ok(!nameValue.includes("[Verify your billing](https://evil.example/phish)"));
  assert.equal(nameValue, "\\[Verify your billing\\](https://evil.example/phish)");
});

test("markdown control characters (bold/italic/strike/code/quote/mention) are escaped in both Name and Email", () => {
  const fields = buildNewMemberNotificationFields({
    // '*' and '_' and '~' and '`' are all legal, unquoted RFC 5321 local-part characters —
    // a real member can register an email containing them.
    email: "evil_*~`user@example.com",
    firstName: "**bold**",
    lastName: "<@&1234567890>_~`",
    clerkUserId: "user_md",
  });
  const nameValue = fields.find((f) => f.name === "Name")?.value ?? "";
  const emailValue = fields.find((f) => f.name === "Email")?.value ?? "";
  for (const raw of ["**bold**", "<@&1234567890>_~`"]) {
    assert.ok(!nameValue.includes(raw), `expected "${raw}" to be escaped, got "${nameValue}"`);
  }
  assert.ok(!emailValue.includes("evil_*~`user@example.com"));
  // Escaping must be reversible/literal: every special char is prefixed with a backslash.
  assert.equal(nameValue, "\\*\\*bold\\*\\* \\<@&1234567890\\>\\_\\~\\`");
  assert.equal(emailValue, "evil\\_\\*\\~\\`user@example.com");
});
