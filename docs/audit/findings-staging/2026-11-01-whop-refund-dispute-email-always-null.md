> **kind:** FINDING

## Whop webhook route's `refund.*`/`dispute.*` branch had its own stale copy of membership/email extraction, missing the field those two event shapes actually use — `email` was ALWAYS null on a refund or chargeback — FIXED

**Status:** Fixed, regression test added (`src/lib/whop-webhook-identity.test.ts`).

### Root cause

`src/app/api/webhook/whop/route.ts` had a shared helper, `extractMembershipAndEmail`, used
consistently by the `payment.failed`/`invoice.past_due`, `invoice.marked_uncollectible`/
`invoice.voided`, and `invoice.paid`/`payment.succeeded` branches. The `refund.created`/
`refund.updated`/`dispute.created`/`dispute.updated` branch did **not** call it — it had its
own, older, hand-rolled duplicate inline in that branch:

```ts
const email = data?.user?.email ?? data?.member?.email ?? data?.payment?.member?.email ?? null;
```

Checked against `@whop/sdk`'s own `.d.ts` (`node_modules/@whop/sdk/resources/webhooks.d.ts`,
`node_modules/@whop/sdk/resources/disputes.d.ts`), none of those three paths exist on a real
refund or dispute payload:

- `RefundCreatedWebhookEvent.Data` / `DisputesAPI.Dispute` have **no top-level `user` or
  `member` field at all** — the first two paths are always `undefined`.
- `payment.member` does exist (both event shapes carry a nested `payment`), but
  `Payment.Member` on these two event types is `{ id: string; phone: string | null }` —
  **no `email` field at all**. The third path is always `undefined` too.
- The real paying user's email lives at **`payment.user.email`** — one level deeper than
  every sibling branch's shape (`payment.failed`/`payment.succeeded` hand `data` the
  `Shared.Payment` object directly, so `user` sits at the top level there, not nested under
  `.payment` — that's why the shared helper's existing `d?.user?.email` worked for THOSE
  events and masked the gap). Dispute payloads additionally carry a top-level
  `customer_email_address` as a second, independent source of the same email.

So on every `refund.created`/`refund.updated`/`dispute.created`/`dispute.updated` webhook,
`email` evaluated to `null`, unconditionally — not sometimes, not depending on payload
content, always. The route's own in-code comment says this branch "also attempt[s] an
immediate re-sync if the owner's email is reachable in the payload" — it never was reachable,
for either of these two event types, since this code shipped.

This is the "duplicated-logic-drift" shape: a correct extraction existed one function away
(`extractMembershipAndEmail`), but this branch predated it (or was never migrated to it) and
kept its own copy, which never picked up the later fixes/field coverage the shared helper
accumulated.

### Blast radius

Impact is real but bounded, because the route does not depend on `email` alone for
correctness:
- `markMembershipRevoked(membershipId)` still runs correctly (the `membershipId` extraction
  path — `data?.membership ?? data?.payment?.membership` — does resolve correctly from
  `payment.membership`, which **does** carry a plain `id`), so the actual entitlement
  revocation (denylist) still fires on a refund/dispute today.
- What was silently lost: the **immediate** re-sync (`syncWhopMembershipForEmail` +
  `publishTierChanged`, i.e. the live tier-cache eviction) that this branch's own comment
  promises "if the owner's email is reachable in the payload." Every refund/dispute instead
  fell through to "will be downgraded by the reconcile cron" (the hourly job) — a real,
  measurable additional-latency regression on top of what the code visibly claims to do, not
  a security hole (the denylist-based revocation is the actual access-control mechanism here
  and was unaffected).
- No other call site was affected — `extractMembershipAndEmail` itself (used by the other
  three event branches) was correct for the shapes it was actually exercised against
  (`Shared.Payment`'s top-level `user`/`member`, `Shared.Invoice`'s top-level
  `email_address`); it simply didn't yet have the `payment.user.email` /
  `customer_email_address` fallbacks the refund/dispute shapes need, because it was never
  asked to handle them.

### Fix rationale

Extracted `extractMembershipAndEmail` out of the route into `src/lib/whop-webhook-identity.ts`
(same pattern already used for `whop-cancellation-notify.ts` — split out of the route so the
pure shape-matching logic is unit-testable without the route's signature-verification/Redis/DB
machinery), extended it with the two missing fallbacks (`payment.user.email`, then
`customer_email_address`), and switched the refund/dispute branch to call the SAME shared
helper instead of keeping its own copy — closing the drift at the root instead of patching
just the one broken field in the duplicate (which would have left two copies to keep in sync
again on the next event-shape surprise).

Deliberately left unchanged: the `membershipId` extraction logic itself (already correct for
every shape checked), the revocation/reconcile-cron fallback behavior (correct design, just
now actually reachable on its "immediate" path too), and every other event branch's existing
behavior (verified via `whop-cancellation-notify.test.ts`/`whop-revocation.test.ts`/
`whop-dunning.test.ts`/`whop-signup-nudge.test.ts`/`whop-trial-nudge.test.ts`/
`whop-checkout.test.ts`/`whop-billing-kind.test.ts` all still passing, 42/42, alongside the 8
new tests).

### Evidence (RED → GREEN)

Reproduced the OLD inline extraction verbatim in isolation and ran the new test file against
it: **4/8 tests failed**, exactly the refund/dispute-shaped cases (payment.failed/invoice
shapes, which the old code handled via the shared helper's own pre-existing paths, still
passed — confirming the bug was specific to the refund/dispute branch's duplicate, not the
shared helper). Restoring the fixed `whop-webhook-identity.ts` and re-running: **8/8 pass**.
Also ran `npx tsc --noEmit` (clean) and the full existing Whop test suite (34 pre-existing
tests, unaffected, all still green).
