## 2026-10-12 — [Admin] Admin panel mislabels manually-set "community" tier users as "free" — FIXED
> **kind:** `FINDING`

| **Area** | **Severity** | **Status** |
|---|---|---|
| Admin console / tier labeling | P2 — cosmetic to the admin, but masks a real desk-access fact | FIXED |

**What's wrong.** `classifyAdminUserAccess` (`src/lib/admin-user-access.ts`) collapsed any
`tier` value other than `"premium"` straight to `"free"`:
```ts
const tier = input.tier === "premium" ? "premium" : "free";
```
and only ever inferred the `"community"` label from `membershipKind`, never from `tier` itself.
That's correct for the normal Whop-webhook path (where `tier` metadata often legitimately stays
`"free"` while `membershipKind` carries `"community"`) — but `PATCH /api/admin/users/[id]`
(`src/app/api/admin/users/[id]/route.ts:135`, via `parseTier(body.tier)`) lets an admin set
`tier: "community"` directly through the Edit User modal's Tier dropdown
(`UserManagement.tsx:594-603`), without ever touching `membership_kind`. Real desk access
(`tierAtLeast` in `src/lib/tiers.ts`, which `desk-tier-requirements.ts` uses to gate SPX at
`"community"`) is granted purely off the raw `tier` value — so an admin who manually comps a
user to `tier: "community"` (a support gesture, a pre-webhook grant) saw that user labeled
**"Free — marketing site + /upgrade only" / "No desk"** in the admin table, while the user could
actually already open `/dashboard` and the SPX desk. The label lied about a real access fact.

**Why untested.** `admin-user-access.test.ts` had a case for `{tier: "free", membershipKind:
"community"}` (the webhook path) but none for `{tier: "community", membershipKind: null}` (the
admin-direct-set path) — the exact gap.

**Fix.** `tier` now preserves `"community"` as its own value (not collapsed to `"free"`), and the
community branch checks `tier === "community" || kind === "community"` instead of only `kind`.
Order preserved: admin bypass first, then premium (tier wins over a stale membershipKind), then
community from either source, then free. Added the missing test case. Verified RED→GREEN:
reverting just `admin-user-access.ts` fails the new test (6 pass / 1 fail); restoring it passes
(7/7).

**Blast radius.** `classifyAdminUserAccess` has 2 real call sites (`src/lib/admin-users.ts`,
and transitively the admin users list/detail API/UI) — label-only change, no change to the real
access-gating logic (`tierAtLeast`/`desk-tier-requirements.ts`), which was already correct.
`tsc --noEmit` clean.

**Verification.**
```
npx tsx --experimental-test-module-mocks --test src/lib/admin-user-access.test.ts
# 7 pass, 0 fail
```

Found via a background Explore-agent sweep of the billing/account/admin surface,
independently re-verified (exact lines, the PATCH route's `parseTier` call, the
`tierAtLeast`/`desk-tier-requirements.ts` real-access chain, and the test file's existing
coverage) before fixing.
