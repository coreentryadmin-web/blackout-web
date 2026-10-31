> **kind:** FINDING

## Admin user "Billing sync runs automatically after create" always no-ops and corrupts the DB tier cache — FIXED

**Status:** FIXED (PR, see branch `fix/admin-create-whop-sync-lock`).

### Root cause

`POST /api/admin/users/create` (`src/app/api/admin/users/create/route.ts`):

1. Creates the Clerk user with `publicMetadata: { tier: parseTier(tier), tier_managed_by:
   "admin", ... }` — `tier_managed_by: "admin"` is written **unconditionally**, regardless of
   whether the admin actually picked a non-default tier in the create form.
2. Writes that chosen tier into the `admin_users` Postgres cache row via `upsertAdminUserRow`.
3. Immediately afterwards (when `syncWhop !== false`, which is always true — the create-user
   modal never sends a `syncWhop` field, see `UserManagement.tsx`'s `CreateUserModal`, and the
   form copy explicitly promises *"Billing sync runs automatically after create"*), calls
   `syncWhopMembershipForEmail(email.trim())` **without** `{ ignoreAdminTierLock: true }`, then
   unconditionally writes the function's *returned* `tier`/`billingKind` back into the same
   `admin_users` row.

`syncWhopMembershipForEmail`'s own admin-tier-lock guard (`isAdminManagedTier`, `membership.ts`
line ~218: `if (!opts?.ignoreAdminTierLock && isAdminManagedTier(existingMeta)) continue;`) exists
specifically so a webhook-driven Whop sync can never clobber a tier an admin set by hand. Because
step 1 just wrote that exact lock onto the brand-new account, step 3's sync call finds the lock on
*every single real run* and `continue`s past the only Clerk user matching the email — so its
return value is always the function's defaults (`tier: "free"`, `billingKind: "free"`,
`updatedUserIds: []`), **regardless of whether the email actually has a real, active Whop
membership**. The sibling endpoint that performs the exact same "check Whop for this email" action
as an explicit admin button — `src/app/api/admin/users/sync/route.ts` — calls the identical
function WITH `{ ignoreAdminTierLock: true }`; `create/route.ts` is the one call site that forgot
it.

The observable bug is two-fold:

- **The stated feature never works.** An admin manually onboarding a known Whop payer (e.g.
  before they've signed in to generate a Clerk account the normal way) gets zero benefit from
  "billing sync runs automatically after create" — it is structurally incapable of detecting a
  real membership for the account it just created.
- **Worse: it silently corrupts the `admin_users` DB cache row on every create.** The unconditional
  second `upsertAdminUserRow({ tier: synced.tier, membershipKind: synced.billingKind })` call
  always writes `"free"`/`"free"` right after the first call wrote the admin's actual choice
  (e.g. `"premium"`) — because `tier = COALESCE(EXCLUDED.tier, users.tier)` in `admin-users.ts`
  only skips a write on `NULL`, not on `"free"`. Clerk's own `publicMetadata.tier` stays correctly
  locked and untouched (so `GET /api/admin/users`'s list/detail views, which read Clerk directly,
  still show the right tier), but the DB cache — which backs the admin dashboard's own
  tier/access **filter** (`listClerkUserIdsByDbFilters` / `shouldUseDbAdminUserList`) — now
  disagrees with Clerk. A freshly admin-created premium user would silently fail to appear under
  a "show premium users" filter immediately after creation.

### Evidence

- Traced the exact lock check in `src/lib/membership.ts` (`isAdminManagedTier`, used at line
  ~218 inside `syncWhopMembershipForEmail`'s per-user loop) and confirmed `create/route.ts`
  (unlike `sync/route.ts`) omits `{ ignoreAdminTierLock: true }`.
- Confirmed `admin-users.ts`'s `upsertAdminUserRow` SQL uses `COALESCE(EXCLUDED.tier, users.tier)`
  — a defined `"free"` string always wins over the previously-written value; only `NULL` would
  have preserved it.
- Confirmed the create-user UI (`UserManagement.tsx`'s `CreateUserModal`) never sends a `syncWhop`
  field, so `syncWhop !== false` is always `true` in practice — this path runs on every create.
- New regression tests (`src/lib/admin-users.test.ts`) prove the extracted decision
  (`shouldApplyWhopSyncToCreatedUser`) is `false` whenever `updatedUserIds` doesn't include the
  freshly-created user's id (the admin-lock no-op case) and `true` only when the sync genuinely
  touched that user — RED (helper missing) before the fix, GREEN after.

### Blast radius

Single call site: `src/app/api/admin/users/create/route.ts`. No other route calls
`syncWhopMembershipForEmail` without `ignoreAdminTierLock` immediately after setting the admin
lock on the same user — `sync/route.ts` (the other caller) already passes the option correctly,
and the webhook/reconcile paths don't set the lock first. `admin-users.ts`'s `upsertAdminUserRow`
COALESCE behavior itself is correct and shared by many callers; it isn't the root cause and wasn't
changed.

### Fix rationale

Added a small, independently-testable pure helper, `shouldApplyWhopSyncToCreatedUser(createdUserId,
syncedUpdatedUserIds)`, in `src/lib/admin-users.ts` (alongside the existing small pure helpers in
that file) that returns whether the sync's result actually applies to the user just created.
`create/route.ts` now only mirrors `synced.tier`/`synced.billingKind` into the `admin_users` DB
cache — and only reports a non-null `whopTier` in its response — when that's true.

This was chosen over simply adding `{ ignoreAdminTierLock: true }` to the sync call (mirroring
`sync/route.ts`): that would also change what happens when the email does **not** have a Whop
membership — it would reset a tier the admin picked on purpose for a non-paying grant (e.g. a
complimentary "premium" account for an employee or promo) back down to "free" immediately after
creation, since `ignoreAdminTierLock: true` makes `syncWhopMembershipForEmail` write `"free"` and
clear `tier_managed_by` for every user it doesn't find a membership for. That is a real, separate
policy question (should an explicit admin tier choice at creation always survive even without a
matching Whop membership?) that this fix deliberately leaves alone — the chosen fix only stops the
cache row being corrupted with data the function itself never actually applied, which is correct
under any resolution of that policy question.
