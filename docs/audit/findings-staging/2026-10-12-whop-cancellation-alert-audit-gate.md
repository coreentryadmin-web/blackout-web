## 2026-10-12 — [FINDING, P3 ops noise] Whop "Membership cancellation started" ops alert was the one call site never gated on `isInternalAuditEmail` — FIXED
> **kind:** `FINDING`

| **Area** | **Severity** | **Status** |
|---|---|---|
| Ops Discord alerts / Whop webhook | P3 — noise risk, not yet confirmed firing live | FIXED |

**What's wrong.** `src/app/api/webhook/whop/route.ts`'s `"Membership cancellation started"`
`notifyOpsDiscord` call (added 2026-08-07, `#1895`, cancellation-reason capture) had no
`isInternalAuditEmail` gate — confirmed via grep, `isInternalAuditEmail` was not imported or used
anywhere in this file. Every OTHER `notifyOpsDiscord` call site in the Clerk webhook path added
after `isInternalAuditEmail` shipped (2026-08-28, `#3012`/`#3029`/`#3031`) — "New member signed
up", the welcome-email send, the Whop-sync call — is explicitly wrapped in `if
(!isInternalAuditEmail(email))`. The cancellation alert simply predates the helper and was never
backfilled, the same shape as two other already-fixed findings this session (`learnIndexNowUrls`,
the FAQ `member-1` price tokens) — a fix landing once and not propagating to a sibling call site
added earlier.

**Why this matters.** `scripts/audit/*.mjs` harnesses routinely mint disposable Clerk+Whop-linked
accounts against production (documented extensively elsewhere in this file's own audit-noise
findings). No committed script currently simulates a `membership.cancel_at_period_end_changed`
event, so this gap is not provably firing live noise today — but it's a real gap waiting for the
first such harness, same risk class as the three already-fixed Discord-noise findings from
2026-08-28 (new-member alerts, welcome-step-1 bounces, audit-account filtering) that were all found
*after* real noise had already accumulated.

**Fix.** Added the `isInternalAuditEmail` import and wrapped the alert's firing condition:
`if (shouldNotifyCancellation(...) && !isInternalAuditEmail(email))`. `email` is guaranteed
non-null in this branch (nested inside the file's existing `if (email) {` at line 261), so no
additional null guard was needed — matches the Clerk route's own gate shape exactly.

**Regression guard.** Added a source-text contract test to `route.test.ts`, matching the file's
own existing style for this exact kind of assertion (the "CQ-114" Redis fail-open test a few lines
above it) rather than constructing a full mocked `membership.cancel_at_period_end_changed` event
through this route's heavy whole-module-mocked signature-verification harness. RED→GREEN confirmed
via `git stash` (1/5 fail pre-fix, 5/5 pass post-fix).

**Verification.** `tsc --noEmit` clean. `npx tsx --experimental-test-module-mocks --test
src/lib/whop-cancellation-notify.test.ts src/lib/internal-audit-email.test.ts
src/app/api/webhook/whop/route.test.ts` — 24/24 pass.

**Blast radius.** One `notifyOpsDiscord` call site in `whop/route.ts`. No change to
`shouldNotifyCancellation`/`buildCancellationNotificationBody` (the pure helpers in
`whop-cancellation-notify.ts`) or any member-facing email (`notifyScheduledCancellation`/
`notifyCancellationReversed`, which fire independently and are correctly left ungated — those are
real cancellation-confirmation emails to the account that just cancelled, not ops noise).

Found via a background Explore-agent sweep of the Discord ops-alert system, independently
re-verified (confirmed the missing import/gate via grep, the Clerk-route pattern it should match,
and that `email` is non-null in scope) before fixing.
