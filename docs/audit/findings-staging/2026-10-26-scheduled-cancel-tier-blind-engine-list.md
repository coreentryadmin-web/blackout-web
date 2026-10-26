## Billing lifecycle: `scheduledCancelEmail` told a community ($49/mo SPX Slayer-only) member that six premium-only engines "stay live" through their grace period

> **kind:** `FINDING`

| | |
|---|---|
| **Status** | FIXED (PR #TBD) |
| **Found by** | Round 105 autonomous bug-hunting sweep (billing/email templates area), 2026-10-26 |
| **Scope** | `src/lib/email/templates/scheduled-cancel.ts`, `src/lib/billing-lifecycle-email.ts` (`notifyScheduledCancellation`), `src/app/api/webhook/whop/route.ts` (`membership.cancel_at_period_end_changed` dispatch) |

### Root cause

`scheduledCancelEmail`'s second body paragraph hardcoded the full seven-product engine list —
*"Every engine you're paying for stays live — SPX Slayer, Thermal, HELIX, Night Hawk, Largo AI,
Vector, Meridian"* — with no awareness of which plan the recipient is actually on. The email
fires from `app/api/webhook/whop/route.ts` on every `membership.cancel_at_period_end_changed`
event with `cancel_at_period_end=true`, regardless of `billingKind`: both a Premium ($199/mo,
all seven engines) member AND a community/SPX-Slayer-only ($49/mo, ONE engine) member scheduling
a cancellation get the identical copy.

A community member was therefore told, by name, that Thermal, HELIX, Night Hawk, Largo AI,
Vector and Meridian "stay live" through their grace period — six products they have never had
access to and are not paying for. This is not merely an upsell miss (the "missing Meridian"
product-count bug class already fixed twice elsewhere, in `welcome-premium.ts`/`downgrade.ts` and
`scheduled-cancel.ts`'s own earlier count fix) — it is an affirmatively false billing
communication: it reads as either "you're about to lose access you thought you had" or "you
always had free access to six premium products," neither of which is true, sent during the one
interaction (a cancellation) where a member is already re-evaluating what they pay for and what
they get.

`notifyScheduledCancellation` had everything needed to avoid this already in scope one call up —
the webhook route resolves `billingKind` from `syncWhopMembershipForEmail(email)` on the very
same event (used two lines later to gate the `complete-signup` nudge on
`billingKind === "premium" || billingKind === "community"`) — but never threaded it into the
email call.

### Blast radius

Checked every sibling billing-lifecycle template for the same tier-blindness:
`welcomePremiumEmail`/`downgradeEmail`/`accessEndedEmail`/`completeSignupEmail` all already
discriminate their copy by `previousTier`/`billingKind`. `scheduledCancelEmail` was the one
template in this family that didn't — `cancelReversedEmail` is unaffected (it names no engines
at all, just "the desk").

### Fix

Added an optional `billingKind?: Extract<BillingKind, "premium" | "community">` field to
`ScheduledCancelContext`. When `billingKind === "community"`, the "stays live" paragraph now
names only SPX Slayer and describes its own scope (SPX regime read, GEX, A-F grading) instead of
the six-engine list; any other value (including the pre-existing omitted case, for backward
compatibility with the one existing test/call site) keeps the original full seven-engine
paragraph. Threaded the real value through:
`notifyScheduledCancellation` now requires `billingKind`, and
`app/api/webhook/whop/route.ts` passes the `billingKind` it already resolved from
`syncWhopMembershipForEmail`, narrowing the defensive `"free"` case (shouldn't occur alongside an
active membership triggering this event, but not provably impossible) to the narrower
`"community"` copy rather than ever overstating access.

Deliberately left unchanged: the subject line, preheader, opening/closing paragraphs (none name
specific engines), and every other billing-lifecycle template.

### Regression test

New file `src/lib/email/templates/scheduled-cancel-tier-blind.test.ts`:
1. `billingKind: "community"` → asserts `SPX Slayer` appears and NONE of Thermal/HELIX/Night
   Hawk/Largo AI/Vector/Meridian appear.
2. `billingKind: "premium"` → asserts all seven names still appear (no regression).
3. Omitted `billingKind` → asserts the full list still renders (backward-compatible default,
   matches the pre-existing `scheduled-cancel-engine-list.test.ts`).

### Verification

- RED→GREEN: `git stash push -- src/lib/email/templates/scheduled-cancel.ts
  src/lib/billing-lifecycle-email.ts src/app/api/webhook/whop/route.ts` (keeping the new test),
  ran `npx tsx --experimental-test-module-mocks --test
  src/lib/email/templates/scheduled-cancel-tier-blind.test.ts` — test 1 failed (`community-tier
  cancellation email must not claim Thermal "stays live"`), tests 2-3 passed trivially pre-fix.
  `git stash pop` restored the fix; all 3 new tests plus the pre-existing
  `scheduled-cancel-engine-list.test.ts` passed (4/4).
- `npx tsx --experimental-test-module-mocks --test src/lib/billing-lifecycle-email.test.ts
  src/lib/email/templates/*.test.ts src/lib/email/*.test.ts` (Node 20) — 40/40 pass.
- `npx tsx --experimental-test-module-mocks --test src/app/api/webhook/whop/route.test.ts`
  (Node 20) — 5/5 pass (the existing `notifyScheduledCancellation` mock is a bare
  `async () => {}`, unaffected by the new required field).
- `npx tsc --noEmit` (Node 20) — clean, exit 0.
- `npx eslint` on all four changed/added files — clean.
