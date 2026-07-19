import { test } from "node:test";
import assert from "node:assert/strict";
import { primaryEmailFromClerkWebhook } from "./clerk-webhook-email";

test("primaryEmailFromClerkWebhook prefers primary_email_address_id", () => {
  const email = primaryEmailFromClerkWebhook({
    primary_email_address_id: "id_b",
    email_addresses: [
      { id: "id_a", email_address: "secondary@example.com" },
      { id: "id_b", email_address: "primary@example.com" },
    ],
  });
  assert.equal(email, "primary@example.com");
});

test("primaryEmailFromClerkWebhook falls back to first address", () => {
  const email = primaryEmailFromClerkWebhook({
    email_addresses: [{ id: "id_a", email_address: "only@example.com" }],
  });
  assert.equal(email, "only@example.com");
});

test("primaryEmailFromClerkWebhook returns null when empty", () => {
  assert.equal(primaryEmailFromClerkWebhook({ email_addresses: [] }), null);
  assert.equal(primaryEmailFromClerkWebhook({}), null);
});
