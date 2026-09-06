## 2026-09-06 — [FINDING, Admin console, P2] Admin user directory double-counted premium+community users, and `access=community` filtering disagreed with the row's own badge — FIXED

> **kind:** `FINDING`

### Symptom

Found during a DISCOVERY-lane sweep of the admin/ops surface for the population/cohort-mismatch
bug class already fixed repeatedly elsewhere this session — this time the pattern showed up as
**three separate implementations of the same "access bucket" classification that disagreed** on
one specific input combination.

### Root cause

`src/lib/admin-user-access.ts`'s `classifyAdminUserAccess()` — the canonical per-row classifier
used for each user's badge in the admin directory — applies a strict priority order: `community`
is only assigned when `tier !== "premium"`; a `tier: "premium"` user is always classified
`"premium"` regardless of `membershipKind`:

```ts
if (kind === "community" && tier !== "premium") { return { accessLabel: "community", ... }; }
if (tier === "premium") { return { accessLabel: "premium", ... }; }
```

But the two SQL-side implementations in `src/lib/admin-users.ts` didn't apply that same exclusion:

- `getAdminUserListStats()` (the stat-card query behind `UserManagement.tsx`'s Premium/Community
  MegaStat cards): `premium` bucket = `tier = 'premium' AND NOT admin` (no `membership_kind`
  exclusion); `community` bucket = `membership_kind = 'community' AND NOT admin` (no `tier`
  exclusion). A user with `tier='premium'` AND `membership_kind='community'` — plausible: a legacy
  SPX-Slayer ($49 community tier) account later upgraded to full Premium without
  `membership_kind` being cleared — is counted in **both** buckets, so
  `premium + community + admins + free > total`.
- `buildAdminUserFilterSql()` (the directory's `access=`/`tier=` filter, driving two live UI
  dropdowns — "Access type" → `community` and the create/edit "Tier" → `community`): same bare
  `membership_kind = 'community'` clause, no `tier` exclusion. Filtering by
  `access=community`/`tier=community` surfaces that same user even though their own row badge
  (driven by `classifyAdminUserAccess`) reads "Premium".

The `free` bucket in both files was already correct — it explicitly excludes both
`'community'` and `'premium'` via `COALESCE(membership_kind, 'free') NOT IN ('community',
'premium')`, matching the canonical fallthrough. Only `community` was missing its `tier`
exclusion.

### Fix

Added `AND COALESCE(tier, 'free') <> 'premium'` to the community clause in all three SQL sites
(the two `buildAdminUserFilterSql` community branches — `access="community"` and
`tier="community"` — plus `getAdminUserListStats`'s community `FILTER`). Used `COALESCE(tier,
'free')` rather than a bare `tier <> 'premium'` because SQL's `<>` against a `NULL` tier column
evaluates to `NULL` (excluded) — the canonical classifier treats a null/non-"premium" tier as
eligible for community (`tier === "premium" ? "premium" : "free"`), so a bare `<>` would have
wrongly excluded null-tier community members while fixing the premium-overlap case, trading one
mismatch for another.

### Evidence

- RED→GREEN: `git stash push -- admin-users.ts` (keeping the new test) → test fails (regex for the
  `COALESCE(tier, 'free') <> 'premium'` exclusion doesn't match the old bare clause) → `git stash
  pop` → test passes.
- New regression test in `admin-users.test.ts` asserts both `access="community"` and
  `tier="community"` SQL clauses carry the exclusion, mirroring `classifyAdminUserAccess`'s
  priority order.
- `npx tsc --noEmit`: clean.
- Targeted tests (`admin-users`, `admin-user-access`): 11/11 pass.
- Full `npm test` (Node 20): see PR for final count.

### Blast radius

`src/lib/admin-users.ts` only (2 functions, 3 clause sites). Consumers unchanged:
`src/app/api/admin/users/route.ts` (stats + filtered listing) and
`src/components/admin/UserManagement.tsx` (MegaStat cards + Access-type/Tier filter dropdowns) —
both now agree with `classifyAdminUserAccess`'s per-row badge without any consumer-side change.

| **Status** | FIXED — PR opened, merge pending CI/peer-review per standing policy |
