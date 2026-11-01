> **kind:** FINDING

## `syncWhopMembershipForEmail` could stamp a multi-email user's `activeMembership` from an unrelated FREE email instead of the email that actually earned their resolved tier — FIXED

| | |
|---|---|
| **File** | `src/lib/membership.ts` |
| **Status** | FIXED (PR, see branch `fix/membership-cross-email-activemembership`) |
| **Severity** | P3 (data-integrity — Clerk metadata / admin dashboard, not live authorization) |

### Root cause

`syncWhopMembershipForEmail` resolves a Clerk user's tier across **every one of their verified
emails** (a real case: a premium subscription on one address plus the $49 community add-on on
another — or simply a secondary address with no purchase at all). Its per-email loop used to be:

```ts
let activeMembership: MembershipListResponse | undefined;
for (const e of emails) {
  const r = await resolveMembershipTierForEmail(e, companyId);
  if (!activeMembership) activeMembership = r.activeMembership;   // <-- the bug
  ...
  if (r.tier === "community") {
    userTier = "community";
    if (!activeMembership) activeMembership = r.activeMembership;
  }
}
```

`resolveMembershipTierForEmail` → `pickActiveMembershipForResolvedTier` deliberately returns an
**arbitrary** non-revoked membership for a FREE-tier email (`sorted.find(...) ?? sorted[0]`,
"nothing tier-specific to preserve" — correct in isolation, and already covered by this file's own
`membership-active-membership-tier-match.test.ts`). The bug is one loop level up: the unconditional
`if (!activeMembership) activeMembership = r.activeMembership;` at the top of the per-email loop
let a FREE email's throwaway pick claim the `activeMembership` slot before a LATER email's real
community/premium membership was ever folded in — the later email's own `if (!activeMembership)`
guard then saw it already non-null and silently kept the wrong one.

This is the exact same tier/`activeMembership` desync that `pickActiveMembershipForResolvedTier`'s
own doc comment already fixed once for a single email's membership list — just reintroduced across
the outer multi-email fold, which had no equivalent test coverage.

### Evidence (RED → GREEN)

Standalone simulation of the OLD inline loop logic, fed `[free email w/ unrelated membership,
community email w/ real membership]`:

```
OLD loop result: {"tier":"community","billingKind":"community","activeMembership":{"id":"m_unrelated_free"}}
BUG CONFIRMED: tier=community but activeMembership is the wrong (free-email) row: m_unrelated_free
```

Extracted the fold into a pure, exported function `foldEmailTierResolution` (same "extract a pure
predicate so it's unit-testable without standing up Clerk/Whop clients" pattern already used by
`isAdminManagedTier`/`isPaidTierForReconcileDowngradeCheck`/`reconcileStatsBucket`/
`pickActiveMembershipForResolvedTier` in this same file) and added 4 regression tests to
`src/lib/membership-active-membership-tier-match.test.ts`:
- a free email's arbitrary pick does not block a later community email's real membership (RED
  against the function not existing pre-fix; GREEN post-fix, and independently confirmed against
  the literal old inline logic above)
- premium always wins and re-adopts its own membership, even after an earlier community fold
- all-free emails never adopt an `activeMembership`
- the first community email's real membership is kept once a later email is also free

All 8 tests in that file pass post-fix (`npx tsx --experimental-test-module-mocks --test
src/lib/membership-active-membership-tier-match.test.ts`), plus the full set of
`membership`-importing test files (`membership-reconcile-downgrade.test.ts`,
`webhook/whop/route.test.ts`, `admin-users-catch-logging.test.ts`, `membership/sync/route.test.ts`,
`whop-signup-nudge.test.ts`, `admin-users.test.ts`) and `tsc --noEmit` clean.

### Blast radius

- `activeMembership?.user?.id` / `activeMembership?.id` → `whop_user_id` / `whop_membership_id`
  written to the user's Clerk `publicMetadata` and surfaced on the admin user dashboard
  (`/api/admin/users`) — a support lookup for a "community" member could land on an unrelated,
  non-qualifying membership row.
- `activeMembership?.plan?.id` → `bestActiveMembershipPlanId` → `billing-lifecycle-email.ts`'s
  `resolveBillingInterval()`, which picks monthly-vs-annual copy for billing lifecycle emails — a
  wrong plan id sourced from the wrong membership could pick the wrong interval copy.
- Scoped to Clerk users with **more than one verified email** where the free email happens to be
  checked first and itself owns a non-qualifying (e.g. lapsed/canceled) Whop membership row — the
  common single-email, single-membership case is unaffected (no second resolution exists to be
  blocked).
- Does **not** affect live authorization/tier gating — `tier`/`membership_kind` themselves were
  already resolved correctly by the existing `if (r.tier === "premium") break;` /
  `if (r.tier === "community") userTier = "community";` logic; only the `activeMembership` object
  (and the two metadata fields it feeds) could point at the wrong row.

### Fix rationale

Extracted the fold step into `foldEmailTierResolution`, a pure reducer that only ever adopts
`activeMembership` from a resolution whose own tier is paid (premium always re-adopts; the first
community resolution is kept once no premium has been seen yet) — never from a free resolution's
arbitrary pick. This mirrors the existing extraction pattern in the same file and preserves the
loop's early-exit-on-premium optimization (one fewer Whop API call per user once premium is found).
No behavior changed for the common case (one email, or multiple emails where the free email simply
has no membership row at all).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PzDkDzjR3bJQsFbXENzsVz
