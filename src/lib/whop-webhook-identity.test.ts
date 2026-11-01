import { test } from "node:test";
import assert from "node:assert/strict";
import { extractMembershipAndEmail } from "./whop-webhook-identity";

// --- refund.created / refund.updated shape (RefundCreatedWebhookEvent.Data) ---
// Per @whop/sdk's webhooks.d.ts: no top-level user/member; payment.member is
// {id, phone} ONLY (no email); the real email lives at payment.user.email.
test("extractMembershipAndEmail: refund payload — email at payment.user.email, not payment.member.email", () => {
  const refundData = {
    id: "ref_123",
    amount: 49,
    payment: {
      id: "pay_456",
      member: { id: "mem_1", phone: null }, // no email field on real Refund payloads
      membership: { id: "mship_789" },
      user: { id: "usr_1", email: "trader@example.com", name: null, username: "trader" },
    },
  };
  const result = extractMembershipAndEmail(refundData);
  assert.equal(result.membershipId, "mship_789");
  assert.equal(result.email, "trader@example.com");
});

// --- dispute.created / dispute.updated shape (DisputesAPI.Dispute) ---
// No top-level user/member/membership; membership lives at payment.membership;
// email can come from EITHER payment.user.email or the top-level customer_email_address.
test("extractMembershipAndEmail: dispute payload — email at payment.user.email", () => {
  const disputeData = {
    id: "disp_1",
    customer_email_address: null,
    payment: {
      id: "pay_1",
      member: { id: "mem_2", phone: null },
      membership: { id: "mship_2" },
      user: { id: "usr_2", email: "disputer@example.com", name: null, username: "disputer" },
    },
  };
  const result = extractMembershipAndEmail(disputeData);
  assert.equal(result.membershipId, "mship_2");
  assert.equal(result.email, "disputer@example.com");
});

test("extractMembershipAndEmail: dispute payload — falls back to top-level customer_email_address when payment.user is absent", () => {
  const disputeData = {
    id: "disp_2",
    customer_email_address: "chargeback@example.com",
    payment: { id: "pay_2", member: { id: "mem_3", phone: null }, membership: { id: "mship_3" }, user: null },
  };
  const result = extractMembershipAndEmail(disputeData);
  assert.equal(result.membershipId, "mship_3");
  assert.equal(result.email, "chargeback@example.com");
});

// --- Regression guard for the bug as it shipped: the OLD inline duplicate in the route
// checked only user.email / member.email / payment.member.email, all of which are absent
// on a real refund/dispute payload, so email always came out null. Confirm the fixed
// shared helper does NOT reproduce that outcome once payment.user.email is present. ---
test("extractMembershipAndEmail: regression — does not silently return null when only payment.user carries the email", () => {
  const payload = {
    payment: {
      membership: { id: "mship_regress" },
      member: { id: "mem_regress", phone: "+15551234567" }, // real shape: no .email
      user: { id: "usr_regress", email: "regress@example.com", name: null, username: "r" },
    },
  };
  const { email } = extractMembershipAndEmail(payload);
  assert.notEqual(email, null);
  assert.equal(email, "regress@example.com");
});

// --- Pre-existing event shapes must keep working exactly as before (no regression) ---

// payment.failed / payment.succeeded: `data` IS the Payment object directly (Shared.Payment),
// so user/member/membership sit at the TOP level, not nested under .payment.
test("extractMembershipAndEmail: payment.failed shape — top-level user.email (unchanged)", () => {
  const paymentData = {
    id: "pay_top",
    member: { id: "mem_top", email: null },
    membership: { id: "mship_top" },
    user: { id: "usr_top", email: "payer@example.com" },
  };
  const result = extractMembershipAndEmail(paymentData);
  assert.equal(result.membershipId, "mship_top");
  assert.equal(result.email, "payer@example.com");
});

// invoice.* shape (Shared.Invoice): top-level email_address, no membership/payment field.
test("extractMembershipAndEmail: invoice shape — top-level email_address, no membership (unchanged)", () => {
  const invoiceData = {
    id: "inv_1",
    email_address: "invoice-recipient@example.com",
    user: null,
  };
  const result = extractMembershipAndEmail(invoiceData);
  assert.equal(result.membershipId, null);
  assert.equal(result.email, "invoice-recipient@example.com");
});

test("extractMembershipAndEmail: membershipId as a bare string (not an object)", () => {
  const data = { membership: "mship_str", user: { email: "bare@example.com" } };
  const result = extractMembershipAndEmail(data);
  assert.equal(result.membershipId, "mship_str");
  assert.equal(result.email, "bare@example.com");
});

test("extractMembershipAndEmail: nothing present — both null, no throw", () => {
  const result = extractMembershipAndEmail({});
  assert.equal(result.membershipId, null);
  assert.equal(result.email, null);
});
