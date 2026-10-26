## Membership self-heal + admin dashboard both missed the legacy `publicMetadata.tier` aliases "pro"/"elite" — raw literal comparison instead of `parseTier` normalization

> **kind:** `FINDING`

| | |
|---|---|
| **Status** | FIXED (PR #TBD) |
| **Found by** | Discovery-lane audit sweep, round 103, 2026-10-26 — Clerk `publicMetadata` read/write surface review outside owned lanes |
| **Scope** | `src/lib/membership.ts` (`isPaidTierForReconcileDowngradeCheck`, consumed by `reconcileAllMemberships`'s downgrade-direction sweep, which `GET /api/cron/membership-reconcile` runs on a schedule); `src/lib/admin-user-access.ts` (`classifyAdminUserAccess`, consumed by `GET /api/admin/users`, `GET /api/admin/users/[id]`, and the client `UserManagement.tsx` admin dashboard) |

### Root cause

`src/lib/tiers.ts`'s `parseTier` has always coerced the legacy tier literals `"pro"` and
`"elite"` to `"premium"` — its own doc-comment and `tiers.test.ts` both confirm these are real,
intentionally-supported aliases, pre-dating the current `"premium"` literal, for
`publicMetadata.tier`. Every member-facing desk gate goes through `parseTier`
(`tier-cache.ts`'s `resolveUserTier` calls `parseTier(user.publicMetadata?.tier)` directly), so a
Clerk user whose metadata still carries one of these legacy values has REAL premium desk access
on the live site today.

Two separate, non-owned-lane functions instead compared the raw metadata string literally,
bypassing `parseTier`'s alias normalization entirely:

1. **`isPaidTierForReconcileDowngradeCheck`** (`membership.ts`) — the predicate
   `reconcileAllMemberships`'s step 2 uses to decide which currently-paid Clerk users get
   re-checked against Whop and downgraded once their membership has actually lapsed. It did
   `tier === "premium" || tier === "community"` on the raw string. A churned/refunded subscriber
   whose Clerk metadata still says `"pro"` or `"elite"` (never rewritten to the literal
   `"premium"` because nothing has touched their metadata since before that literal existed) was
   **invisible to this sweep** — exactly the same failure shape as the already-documented bug
   this same function fixed for the `"community"` tier (a dropped `membership.deactivated`
   webhook leaves them paid forever, because this hourly/daily self-heal is the ONLY backstop and
   it never looked at them). This is a real revenue-leak risk, not a cosmetic one: the very
   purpose of `reconcileAllMemberships` is to catch exactly this class of drift, and this
   predicate silently excluded one alias family from "exactly this class."

2. **`classifyAdminUserAccess`** (`admin-user-access.ts`) — the admin-dashboard-only access
   classifier, same root cause: `input.tier === "premium" ? "premium" : input.tier === "community"
   ? "community" : "free"`. A legacy `"pro"`/`"elite"` member would show up on the admin Users
   list/detail page bucketed as `"free"` with `deskAccess: false` ("Free signup — marketing site +
   /upgrade only"), even though `resolveUserTier` grants them full premium desk access right now.
   This misleads an operator checking a real paying member's access — the admin dashboard is the
   one place a human would look to answer "does this person have premium," and it answered wrong
   for this alias class. Three call sites share the fix: `GET /api/admin/users`,
   `GET /api/admin/users/[id]`, and the client-side mirror in `UserManagement.tsx` (which imports
   the same shared function, so no separate change was needed there).

### Fix

Normalized both functions through `parseTier` instead of a raw literal comparison:

```ts
// membership.ts
export function isPaidTierForReconcileDowngradeCheck(tier: string): boolean {
  const normalized = parseTier(tier);
  return normalized === "premium" || normalized === "community";
}
```

```ts
// admin-user-access.ts
const tier = parseTier(input.tier);
```

Deliberately minimal — reuses the exact normalization function every other consumer of
`publicMetadata.tier` already trusts, rather than inventing a second alias list that could drift
from `parseTier`'s own. As a side effect, once `reconcileAllMemberships` picks up a legacy
`"pro"`/`"elite"` user, `syncWhopMembershipForEmail`'s write-back (`updateClerkMembershipMetadata`)
always writes the normalized `Tier` literal (`"free"`/`"community"`/`"premium"`), so running the
cron also permanently migrates that user's metadata off the legacy alias — no separate migration
script needed.

Left unchanged: `parseTier` itself (already correct), every other call site that already used
`parseTier`/`resolveUserTier` (already correct), and the raw `String(meta.tier ?? "free")` display
values in `src/app/api/admin/users/[id]/route.ts`'s JSON response (`tier`, audit-log `detail.tier`)
— those surface the literal stored string for debugging/audit-trail purposes, which is a
different, deliberate use case from the access-bucket classification this finding targets.

### Regression tests

- `src/lib/membership-reconcile-downgrade.test.ts`: new test asserting
  `isPaidTierForReconcileDowngradeCheck("pro")` and `("elite")` both return `true`.
- `src/lib/admin-user-access.test.ts`: new test asserting `classifyAdminUserAccess({ tier: "pro" })`
  and `({ tier: "elite" })` both resolve to `accessLabel: "premium"`, `deskAccess: true`.

### Verification

- RED→GREEN: both new tests failed (`false !== true` / `'free' !== 'premium'`) against the
  pre-fix code, confirmed via direct run before the fix was applied; both pass after.
- `npx tsx --experimental-test-module-mocks --test src/lib/membership-reconcile-downgrade.test.ts
  src/lib/admin-user-access.test.ts src/lib/membership-activating.test.ts
  src/lib/membership-sync-limit.test.ts src/lib/membership-tiebreak.test.ts src/lib/tiers.test.ts`
  (Node 20) — 37/37 pass.
- `npx tsc --noEmit` (Node 20) — clean, exit 0.
- `npx eslint src/lib/membership.ts src/lib/admin-user-access.ts
  src/lib/membership-reconcile-downgrade.test.ts src/lib/admin-user-access.test.ts` — clean.
- Full `npm test` suite run (Node 20) before pushing.
