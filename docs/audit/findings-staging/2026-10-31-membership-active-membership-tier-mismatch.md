> **kind:** FINDING

## `resolveMembershipTierForEmail` can stamp a community membership as "active" for a user whose resolved tier is premium — FIXED

**Status:** Fixed, regression tests added (`src/lib/membership-active-membership-tier-match.test.ts`).

### Root cause

`membership.ts`'s `resolveMembershipTierForEmail` resolves a single `tier`/`billingKind` for an
email from the FULL list of that email's Whop memberships (`resolveTierFromMemberships`/
`resolveBillingKindFromMemberships`, both "premium wins over community" across the whole list),
but it picked `activeMembership` — the single membership whose id/plan gets stamped downstream —
completely independently of that resolved tier:

```ts
const sorted = sortMemberships(memberships);
const tier = resolveTierFromMemberships(sorted, revoked, dunningGrace);
const billingKind = resolveBillingKindFromMemberships(sorted, revoked, dunningGrace);
const activeMembership = sorted.find((m) => !revoked.has(m.id)) ?? sorted[0];
```

`sortMemberships` (`membership-sort.ts`) orders purely by Whop **status** (active > trialing >
completed > past_due > canceling) and, within a status tie, by `created_at` descending — it has
no notion of premium vs community vs neither. A real member can hold BOTH a premium subscription
AND the $49 SPX Slayer community add-on (`whop.ts`'s `getCommunityProductIds()`/
`communityProducts.includes(productId)` branch in `resolveTierFromMembership` exists precisely
because these are modeled as distinct Whop products/memberships, never the same row). Whenever the
community membership happens to sort ahead of the premium one — e.g. it was created more recently
while both are `active`, or the premium one is only `active` via a `past_due`/`canceling` grace
status that still resolves to `premium` through `resolveTierFromMembership` but sorts behind a
plain `active` community row — `activeMembership` silently becomes the COMMUNITY row even though
`tier` correctly resolved to `"premium"`.

This was introduced (not deliberate) when `ee282d113` (refund/chargeback revocation, launch-path
#6) added the `revoked` exclusion on top of what was previously a bare `sorted[0]` — the original
author never revisited whether the "first non-revoked" selection still made sense once the two
resolution functions it feeds (`resolveTierFromMemberships`/`resolveBillingKindFromMemberships`)
started classifying by PRODUCT across the whole list rather than by the first row alone.

### Evidence

- Read `membership.ts`, `whop.ts`, `membership-sort.ts` end-to-end; confirmed via
  `git log --oneline -S "sorted.find((m) => !revoked.has(m.id)) ?? sorted[0]" -- src/lib/membership.ts`
  that this exact selection was never tier-aware at any point in its history.
- New regression tests (`membership-active-membership-tier-match.test.ts`) construct the exact
  failure shape: a `community`-product membership created 2026-06-01 and a `premium`-product
  membership created 2026-01-01, both `status: "active"` — `sortMemberships` puts the community
  row first on the `created_at` tiebreak, which is exactly the pre-fix input that produced a
  premium-tier user with a community `activeMembership`.
- **RED (pre-fix, via `git stash` on `membership.ts` only, keeping the new test file):** all 4
  new tests failed with `pickActiveMembershipForResolvedTier is not a function` (the export did
  not exist pre-fix) — confirming the test exercises code that did not exist before this change,
  and separately confirming by inspection that the removed call site (`sorted.find(...) ??
  sorted[0]`) picks the community row first in that fixture.
- **GREEN (fix restored):** 4/4 new tests pass; full re-run of
  `membership-active-membership-tier-match.test.ts` + `membership-tiebreak.test.ts` +
  `membership-reconcile-downgrade.test.ts` + `membership-sync-limit.test.ts` +
  `whop-billing-kind.test.ts` + `membership-activating.test.ts` — 23/23 pass.
- `npx tsc --noEmit` clean on the whole project.
- `npx eslint src/lib/membership.ts src/lib/membership-active-membership-tier-match.test.ts` clean.

### Blast radius

Single call site (`resolveMembershipTierForEmail`'s `activeMembership` assignment) — grepped for
any other duplicate of this selection pattern (`sorted.find((m) => !revoked...`) and found none.
Everything downstream of `activeMembership` inherits the fix automatically:
- `syncWhopMembershipForEmail`'s `whop_user_id`/`whop_membership_id` stamped into Clerk
  `publicMetadata` (and `upsertAdminUserRow`'s `whopUserId`) — surfaced on the admin user
  dashboard (`GET /api/admin/users`, `/api/admin/users/[id]`) as the membership record for that
  user; a support lookup for a "premium" user could previously land on an unrelated community
  membership id.
- `bestActiveMembershipPlanId` → `syncWhopMembershipForEmail`'s returned `activeMembershipPlanId`
  → `billing-lifecycle-email.ts`'s `dispatchTransitionEmail` passes it straight to
  `resolveBillingInterval(planId)` to decide monthly-vs-annual copy in the **welcome-premium**
  transactional email on a free→premium or community→premium transition. A desynced plan id here
  means a real, currently-upgrading premium subscriber could be told the wrong billing interval,
  sourced from a plan that was never their premium plan.
- `reconcileAllMemberships` (the hourly self-heal sweep) calls the same
  `syncWhopMembershipForEmail` for every tracked email, so the same desync was live on every
  reconcile pass too, not just the real-time webhook path.

### Fix rationale

Extracted the selection into a pure, exported predicate,
`pickActiveMembershipForResolvedTier(sorted, revoked, tier, dunningGraceIds)` — same pattern this
file already uses for `isPaidTierForReconcileDowngradeCheck`/`reconcileStatsBucket` (pure
predicates kept unit-testable without standing up Clerk/Whop clients). When the resolved `tier` is
paid (`"premium"` or `"community"`), it prefers the first non-revoked membership whose OWN
classification (`resolveTierFromMembership`, already exported from `whop.ts`) actually matches
that tier — guaranteeing `activeMembership` is always consistent with the `tier`/`billingKind`
already resolved from the same list. Falls back to the original "first non-revoked, else first
overall" behavior when `tier === "free"` (nothing tier-specific to preserve there) or if, in a
case that should not occur in practice, no membership happens to match.

Considered and rejected: changing `sortMemberships` itself to also weigh premium-vs-community
(it is a general-purpose, correctly-scoped "most relevant Whop status" sort used elsewhere and
unit-tested on its own terms in `membership-tiebreak.test.ts`; conflating it with tier
classification would require it to know about `whop.ts`'s product-id configuration, which it
currently has no dependency on and should not need).

### Deliberately left unchanged

- `sortMemberships`/`membership-sort.ts` — correct and unit-tested for what it actually promises
  (status + recency ordering); not itself the bug.
- `resolveTierFromMemberships`/`resolveBillingKindFromMemberships`/`resolveTierFromMembership`
  (`whop.ts`) — already correctly "premium wins over community" across the whole list; the bug
  was purely in how `activeMembership` was picked downstream of their already-correct result.
- `syncWhopMembershipForEmail`'s per-Clerk-user loop (lines ~280-305) — its own
  `activeMembership = r.activeMembership`/`if (!activeMembership) activeMembership =
  r.activeMembership` reassignments already correctly prefer the per-email result that produced
  `userTier === "premium"`; only the single-email `resolveMembershipTierForEmail` helper itself
  had the bug.
