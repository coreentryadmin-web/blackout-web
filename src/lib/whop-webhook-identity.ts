/**
 * Pure membership/email extraction for Whop webhook payloads — split out of the webhook
 * route so the shape-matching logic is unit-testable without the route's
 * signature-verification/Redis/DB machinery (same pattern as whop-cancellation-notify.ts).
 *
 * ROOT CAUSE this fixes: refund.created/refund.updated/dispute.created/dispute.updated
 * carry the paying user at `data.payment.user.email` — ONE level deeper than every other
 * event type this route handles (payment.failed/payment.succeeded hand `data` the Payment
 * object directly, so its `user` is top-level; invoice.* events carry a top-level
 * `email_address`). The webhook route used to re-implement its own, OLDER extraction
 * inline for the refund/dispute branch instead of calling this shared helper, and that
 * inline copy checked `data.user.email` / `data.member.email` /
 * `data.payment.member.email` — none of which exist on a Refund or Dispute payload
 * (confirmed against `@whop/sdk`'s own `.d.ts`: `RefundCreatedWebhookEvent.Data` and
 * `DisputesAPI.Dispute` have no top-level `user`/`member`, and their nested
 * `payment.member` is `{ id, phone }` only — no `email` field at all). So `email` was
 * ALWAYS null for refund/dispute events, silently skipping the "re-sync immediately"
 * path the route's own comment describes (it fell back to the hourly reconcile cron
 * instead — a real, measurable delay bug, not a total data loss, but a genuine drift
 * from what the code claims it does).
 *
 * Fix: this shared helper now also tries `payment.user.email` (the field Refund/Dispute
 * payloads actually use) before falling back to `email_address`
 * (Invoice-shaped payloads) and `customer_email_address` (Dispute-shaped payloads).
 */
export function extractMembershipAndEmail(data: unknown): {
  membershipId: string | null;
  email: string | null;
} {
  const d = data as {
    membership?: { id?: string } | string;
    payment?: {
      membership?: { id?: string } | string;
      member?: { email?: string | null };
      user?: { email?: string | null };
    };
    user?: { email?: string | null };
    member?: { email?: string | null };
    // `Shared.Invoice` payloads (invoice.past_due, invoice.marked_uncollectible,
    // invoice.voided, invoice.paid) carry the recipient at top-level `email_address`
    // and have no `membership`/`user`/`member` field at all — every other branch
    // above falls through to null on an invoice event without this.
    email_address?: string | null;
    // `DisputesAPI.Dispute` payloads (dispute.created, dispute.updated) carry the
    // disputing customer's email here, top-level, and have no top-level
    // `user`/`member`/`email_address` field at all.
    customer_email_address?: string | null;
  };
  const mRaw = d?.membership ?? d?.payment?.membership;
  const membershipId = typeof mRaw === "string" ? mRaw : (mRaw?.id ?? null);
  const email =
    d?.user?.email ??
    d?.member?.email ??
    d?.payment?.member?.email ??
    // Refund/Dispute payloads (refund.created, refund.updated, dispute.created,
    // dispute.updated) nest the paying user one level deeper than every sibling
    // branch above — see the module header for why.
    d?.payment?.user?.email ??
    d?.email_address ??
    d?.customer_email_address ??
    null;
  return { membershipId, email };
}
