> **kind:** FINDING

## Admin dashboard "Community" filter/stats miss users whose `tier` was set directly to `community` — FIXED

**Status:** Fixed in `fix/admin-community-tier-filter` (this PR).

### Root cause

`src/lib/admin-user-access.ts`'s `classifyAdminUserAccess` — the function that badges each row
in the admin user list — documents and implements **two independent signals** for the
"Community" access label:

```ts
// Community can be signaled either by the Whop membershipKind (the normal webhook path,
// where `tier` metadata itself often stays "free") or by `tier` directly (an admin manually
// setting tier=community via the Edit/Create User modal, which never touches membershipKind)
if (tier === "community" || kind === "community") { ... "community" ... }
```

But `src/lib/admin-users.ts`'s `buildAdminUserFilterSql` (backs the admin dashboard's
`access=community` and `tier=community` query-string filters) and `computeAdminUserListStats`
(backs the dashboard's stat tiles) only ever checked the **first** signal:

```ts
// buildAdminUserFilterSql, pre-fix
} else if (access === "community") {
  clauses.push(`membership_kind = 'community' AND COALESCE(tier, 'free') <> 'premium'`);
} ...
} else if (tier === "community") {
  clauses.push(`membership_kind = 'community' AND COALESCE(tier, 'free') <> 'premium'`);
}

// computeAdminUserListStats, pre-fix
if (row.membership_kind === "community" && (row.tier ?? "free") !== "premium") community++;
```

Neither clause ever referenced the `tier` column's own value, only `membership_kind`. The
second signal `classifyAdminUserAccess` names — an admin directly setting `tier='community'`
via the Edit/Create User modal — is real and confirmed live in the code: `PATCH
/api/admin/users/[id]` (`src/app/api/admin/users/[id]/route.ts`) writes **only**
`metaUpdates.tier` when `"tier" in body`; it never touches `membership_kind`. The row's
Postgres mirror (`upsertAdminUserRow`, called right after) then persists whatever
`meta.membership_kind` currently is (`null` for a user who never went through the Whop webhook
path) alongside `tier='community'`.

### Evidence

Added a regression test exercising the real, unmodified `buildAdminUserFilterSql` and
`computeAdminUserListStats` functions with a `{ tier: "community", membership_kind: null }` row
— exactly the shape an admin-set-community user's DB row has. Pre-fix (confirmed via
`git stash` isolating the fix from the test): **2 of 14** `admin-users.test.ts` tests failed —
`buildAdminUserFilterSql`'s generated WHERE clause never contained `tier = 'community'`, and
`computeAdminUserListStats` returned `community: 0` for a row that should count as community
(`{ total: 1, premium: 0, admins: 0, community: 0, free: 0 }` — the row vanished from every
bucket, so the stat tiles' bucket sum (0) silently fell short of `total` (1)). Post-fix: all 14
pass, 14/14.

### Blast radius

- **`buildAdminUserFilterSql`** — both the `access === "community"` branch (admin dashboard's
  "Community" access filter) and the `tier === "community"` branch (the plain tier dropdown
  filter) shared the identical buggy clause and both needed the identical fix.
- **`computeAdminUserListStats`** — the dashboard's "Community" stat tile undercounted by
  exactly the admin-set-community population; a user who vanishes from every bucket this way
  also makes `premium + community + free + admins < total` for anyone cross-checking the tiles.
- **Not affected:** `classifyAdminUserAccess` itself (the per-row badge logic was already
  correct — it is the one both SQL functions needed to match), `upsertAdminUserRow` (writes
  `membership_kind` faithfully from Clerk metadata; the mismatch is a read-side classification
  gap, not a write-side data-integrity bug), and the `free`/`premium` buckets (unaffected since
  neither one's condition can be satisfied by a `tier='community'` row either way).

### Fix rationale

Changed both SQL clauses from `membership_kind = 'community' AND COALESCE(tier,'free') <>
'premium'` to `(tier = 'community' OR membership_kind = 'community') AND COALESCE(tier,'free')
<> 'premium'` — the OR mirrors `classifyAdminUserAccess`'s own two-signal check, and the
existing `<> 'premium'` exclusion is kept unchanged (still needed for the
`membership_kind='community', tier='premium'` case, where tier wins per
`classifyAdminUserAccess`'s priority order — already covered by an existing test). Applied the
identical OR to `computeAdminUserListStats`'s community-bucket condition. Left the `free` and
`premium` branches/buckets untouched — neither's existing logic is affected by this gap, and
widening them was not needed to close it.

### Files changed

- `src/lib/admin-users.ts` — `buildAdminUserFilterSql` (both community clauses),
  `computeAdminUserListStats` (community bucket condition).
- `src/lib/admin-users.test.ts` — two new regression tests (RED pre-fix via `git stash`, GREEN
  post-fix).
