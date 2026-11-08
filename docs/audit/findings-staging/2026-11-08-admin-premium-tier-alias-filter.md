> **kind:** FINDING

# Admin directory Premium filter/stats miss users whose `tier` is a legacy "pro"/"elite" alias

| | |
|---|---|
| **Status** | FIXED |
| **Area** | Admin dashboard — user directory (`src/lib/admin-users.ts`) |
| **Severity** | P3 — dashboard filter/stat undercount, no desk-access or billing impact |

## Root cause

`parseTier` (`src/lib/tiers.ts`) normalizes three raw tier strings to the canonical `"premium"`:
the literal `"premium"` plus two legacy pre-rename aliases, `"pro"` and `"elite"`. Every consumer
that grants real behavior off a user's tier already normalizes through it:

- `tier-cache.ts`'s `resolveUserTier` — real member-facing desk access.
- `admin-user-access.ts`'s `classifyAdminUserAccess` — the admin dashboard's own per-row
  `accessLabel`/`deskAccess` badge, which the file's own comment states explicitly: *"parseTier
  has always coerced those for the member-facing desk gate... this label must agree, or the admin
  dashboard is the one place that misreports a real paying member as 'free'."*
- `membership.ts`'s `isPaidTierForReconcileDowngradeCheck` — the Whop reconcile cron's
  downgrade-direction sweep. That function's own comment documents this EXACT bug class already
  having been fixed there once: *"a Clerk user whose metadata still carries the pre-'premium'-
  literal alias was invisible to this sweep — the same shape as the 'community' omission fixed
  below, just one alias layer earlier."*

`buildAdminUserFilterSql` (the admin user directory's `access=premium`/`tier=premium` WHERE-clause
builder, operating on the Postgres `users` mirror) and `computeAdminUserListStats` (the dashboard's
Premium/Community/Free stat-tile counter, operating on the same mirror) were the one place left
comparing the **raw literal** `tier === "premium"` / `tier = 'premium'` instead of the normalized
value. A row whose `users.tier` column still carries `"pro"` or `"elite"` — e.g. a legacy mirror
row that predates `upsertAdminUserRow`'s write paths normalizing with `parseTier` on write, or any
future drift between Clerk's `publicMetadata.tier` and this Postgres cache — is badged **"Premium"**
by `classifyAdminUserAccess` in the dashboard's default (unfiltered) list, yet:

1. **Invisible** to the "show Premium users" filter (`access=premium`/`tier=premium`), despite its
   own badge reading "Premium" one column over.
2. **Uncounted** in the Premium stat tile (and not mis-added to Free or Community either — it
   simply disappears from every per-tier bucket while `total` still includes it), so
   `premium + community + free + admins` can undercount `total` whenever such a row exists.
3. **Wrongly matched** by the Community filter/stat if the same row also carries
   `membership_kind='community'` — `classifyAdminUserAccess`'s priority order treats `tier` as
   winning over `membership_kind` (a premium-tier user is never "Community", alias or not), but
   the pre-fix community clause only excluded the literal `tier = 'premium'`, so a
   `tier='pro', membership_kind='community'` row would match the community filter/bucket despite
   its own badge reading "Premium" — the double-count failure mode, not just the omission one.

This is the exact "badge disagrees with filter/stats" shape already fixed once in this same file
for the Community dual-signal case (buildAdminUserFilterSql's existing `access === "community"`
comment and its own regression tests), just at the Premium-alias layer the `isPaidTierForReconcile-
DowngradeCheck` fix in `membership.ts` already named as a sibling gap ("one alias layer earlier").

## Evidence (RED → GREEN)

Added four regression tests to `src/lib/admin-users.test.ts` (one on `buildAdminUserFilterSql`'s
SQL shape, three on `computeAdminUserListStats`'s bucket counts) asserting a `tier='pro'`/`'elite'`
row is recognized as Premium, including when it also carries `membership_kind='community'`.

Pre-fix (`git stash` the code change, keep the new tests): **5 failing assertions** — the SQL
clauses still read the literal `tier = 'premium'`/`<> 'premium'`, and `computeAdminUserListStats`
on a `tier='pro'` row returned `{ premium: 0, community: 0 }` (simple omission) and on
`{ tier: 'pro', membership_kind: 'community' }` returned `{ premium: 0, community: 1 }` (the
mis-match case).

Post-fix: all 17 tests in the file pass, including the 4 new ones and all 13 pre-existing ones
(the pre-existing SQL-shape assertions were updated from `tier = 'premium'` to
`tier IN ('premium', 'pro', 'elite')` to match the new, wider clause — the underlying behavior
those tests check, admin bucket priority and the existing community dual-signal fix, is
unchanged).

```
# pass 17
# fail 0
```

## Fix

- Added `PREMIUM_TIER_SQL_VALUES = "'premium', 'pro', 'elite'"` in `admin-users.ts` and used it in
  every SQL clause that means "this row's tier normalizes to premium" (`access === "premium"`,
  `tier === "premium"`) and every clause that means "exclude a row whose tier normalizes to
  premium" (both `access === "community"` and `tier === "community"`'s existing exclusion, widened
  from `<> 'premium'` to `NOT IN (...)`).
- In `computeAdminUserListStats`, replaced the raw `row.tier === "premium"` check with
  `parseTier(row.tier) === "premium"`, and reused that same normalized value for the community
  bucket's premium-exclusion check (previously `(row.tier ?? "free") !== "premium"`).

## Fix rationale

Mirrors the exact pattern this codebase already uses for the Community dual-signal fix in the
same file, and for the identical alias gap already fixed once in `membership.ts`'s
`isPaidTierForReconcileDowngradeCheck` — reusing `parseTier` (the single source of truth for what
a raw tier string means) rather than inventing a second definition of "premium" here. Deliberately
left the `access === "free"`/`tier === "free"` clauses untouched: `"pro"`/`"elite"` never equal the
literal `"free"`, so those clauses were never at risk of mismatching a legacy-aliased row (the gap
was specifically in recognizing/excluding the alias as *premium*, not in the free bucket's own
logic). Also left `parseAdminUserTier`/`isValidCreateUserTier` untouched — those are deliberately
*strict* allowlists gating new admin-initiated writes (reject `"pro"`/`"elite"` so a typo 400s
instead of silently demoting a member), a different purpose from reading an existing row's tier,
and this fix does not change what an admin can set going forward.

## Blast radius

`buildAdminUserFilterSql` and `computeAdminUserListStats` have exactly two production call sites
(`listClerkUserIdsByDbFilters` and `getAdminUserListStats`, both in the same file), both already
covered by the existing + new tests. No other file references these functions or their exact SQL
string shape.
