> **kind:** FINDING

## Welcome-Premium email told every new annual subscriber the refund window had already closed — FIXED

**Status:** FIXED (`fix/welcome-premium-guarantee-claim`)

### Root cause

`src/lib/email/templates/welcome-premium.ts`'s `annualLine` (rendered only when
`ctx.billingInterval === "yearly"`) read:

> "You're locked in at $X for the full year — **the 7-day guarantee's already come
> and gone, satisfied.** Nothing left to decide. The desk's open. Go trade."

`welcomePremiumEmail()` is not a delayed, several-days-later digest — it is dispatched
synchronously, in real time, the moment a Premium subscription starts. The call chain is:

- `src/app/api/webhook/whop/route.ts` receives Whop's `membership.activated` webhook and calls
  `syncWhopMembershipAndNotify(email)` (billing-lifecycle-email.ts) on that same request.
- `syncWhopMembershipAndNotify` diffs the member's tier and, on an upgrade to `premium`, calls
  `dispatchTransitionEmail()`, which calls `welcomePremiumEmail({ firstName, previousTier,
  billingInterval })` and sends it immediately (`billing-lifecycle-email.ts:146-150`).
- The module's own doc comment on `syncWhopMembershipAndNotify` states it is used "ONLY on the
  real-time webhook path... NOT the hourly reconcile cron" specifically so transition emails fire
  "exactly when the user's tier actually changed" — i.e. at activation, not after a delay.

So for a brand-new (or upgrading) **yearly** Premium subscriber, this email lands on day one of
the subscription — the exact moment the refund window *opens*, not after it closes. The site's own
refund policy (`src/app/(marketing)/refund-policy/page.tsx`) states: "Annual subscriptions are
non-refundable after the first 7 days. If you are unsatisfied... [eligible for a] refund. After the
7-day window, annual subscriptions are non-refundable..." — i.e. the clock starts at the
subscription date, which is precisely when this email is sent.

Claiming the guarantee is "already come and gone, satisfied" on day one is factually backwards: a
member reading it could reasonably conclude they'd already forfeited a refund right they in fact
still held for the next 7 days, which is the opposite of what a money-back guarantee is supposed to
communicate and the opposite of the policy's own terms.

### Evidence

- `src/lib/billing-lifecycle-email.ts:140-150` (`dispatchTransitionEmail`) — `welcomePremiumEmail`
  is called and sent inline, in the same async function invoked directly from the webhook route on
  `membership.activated`; no delay, no queued "day 7" follow-up.
- `src/app/api/webhook/whop/route.ts:233-252` — `syncWhopMembershipAndNotify(email)` is called
  synchronously inside the webhook handler for `membership.activated`.
- `src/app/(marketing)/refund-policy/page.tsx:37-39` — the 7-day annual refund window is anchored to
  the subscription's start, not some earlier point already elapsed by the time of signup.
- RED→GREEN: added
  `src/lib/email/templates/welcome-premium-guarantee-claim.test.ts`, asserting the rendered HTML
  never claims the guarantee "already come and gone" and still names the guarantee as live. Before
  the fix, `assert.doesNotMatch(html, /guarantee's already come and gone/)` failed (the string was
  present verbatim); after the fix it passes.

### Blast radius

Single call site: `annualLine` is only referenced once, inside `welcomePremiumEmail()`
(`welcome-premium.ts`), and only one template builds it. No other template (`downgrade.ts`,
`scheduled-cancel.ts`, `trial-ending-soon.ts`, `access-ended.ts`, `welcome-community.ts`,
`payment-failed.ts`, `cancel-reversed.ts`, `welcome-sequence.ts`) contains the same or an analogous
"guarantee already elapsed" claim — checked by reading each file in full this round; none of them
reference `MEMBERSHIP_PRICING.yearly`'s guarantee at all except this one line.

### Fix rationale

Replaced the false "already come and gone, satisfied" claim with language that correctly describes
the guarantee as starting today and running for the stated window, while still making the same
practical point the original line wanted to make (you're locked in, no further billing decision is
needed right now):

> "You're locked in at $X for the full year — and you've got a 7-day money-back guarantee starting
> today if it's not the right fit. After that, the rate's locked for the full twelve months. Nothing
> to decide right now. The desk's open. Go trade."

Left unchanged: everything else in the file (the dual-opener by `previousTier`, the shared
paragraphs, the monthly branch which renders no `annualLine` at all — verified by the second new
test). This is a pure copy-accuracy fix; no pricing values, billing logic, or email-dispatch timing
changed.
