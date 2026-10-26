> **kind:** `FINDING`

## Admin console's User management stats counted leftover audit/test-harness accounts as real "Admins", driving Premium/Free/Community to 0 — FIXED

**Status.** FIXED (PR #6787).

### Area

`/admin/users` (Admin console, non-owned) — `getAdminUserListStats()` in `src/lib/admin-users.ts`,
rendered by `UserManagement.tsx`'s five KPI tiles (Total users / Premium / Free signup / Community
/ Admins).

### Found by

Live-UI sweep (`proxy-browser.cjs`, desktop viewport, temp admin Clerk session) of a desk not yet
visually checked today, DISCOVERY-lane, 2026-10-26.

### Symptom

Live screenshot of `/admin/users`:

- **TOTAL USERS 1600**
- **PREMIUM 0**
- **FREE SIGNUP 0**
- **COMMUNITY 0**
- **ADMINS 1456**

1456 of 1600 users — 91% — reported as admins is implausible for a real paid product, and the
Premium/Free/Community tiles reading exactly **0** directly contradicts the table rendered right
below them, whose first visible rows show real `ACCESS: FREE` users (and the first two rows are
themselves `claude-audit-temp+...@blackouttrades.com` with `ACCESS: ADMIN`).

### Root cause

`scripts/audit/lib/clerk-audit-user.mjs`'s `mintClerkPremiumSession` (used throughout this
repo's own audit toolkit — including by this very DISCOVERY-lane session) defaults new temp Clerk
users' `publicMetadata` to `{role: "admin", tier: "premium"}`. The Clerk `user.created`/
`user.updated` webhook (`src/app/api/webhooks/clerk/route.ts`) already recognizes these accounts
via `isInternalAuditEmail()` and skips the welcome email, the ops-Discord ping, and the Whop sync
for them — **but it does not skip writing them into the Postgres `users` table**, the mirror
`getAdminUserListStats()` counts from. Every audit/test-harness run across the whole fleet (this
repo's own `scripts/audit/*.mjs`, run "dozens of times a day" per the webhook's own comment) leaves
a `role='admin', tier='premium'` row behind unless its Clerk-side cleanup *and* the resulting
`user.deleted` webhook both land cleanly — any crashed/interrupted run (a real, repeatedly-observed
failure mode per this repo's own `CLAUDE.md` concurrency-hazard notes) leaves an orphaned row.
Accumulated over enough runs, these synthetic rows came to dominate the live counts.

### Fix

Extracted the bucket-classification logic into a pure, exported `computeAdminUserListStats(rows,
adminEmailsLower)` (mirrors today's other extracted-pure-helper fixes — `computeMttaMs`,
`deriveMeridianEarningsErrors`) that skips any row whose `email` matches the SAME
`isInternalAuditEmail()` the webhook already uses elsewhere — single source of truth, no
risk of the two drifting apart (this repo's own `internal-audit-email.ts` documents three
historical rounds of exactly that drift across ~30 ad-hoc harnesses). `getAdminUserListStats()`
now fetches `(email, tier, role, membership_kind)` and calls the pure helper, replacing the prior
single aggregate `COUNT(*) FILTER` SQL query — bucket priority (admin wins over
premium/community/free; the remaining three independently evaluated) is preserved exactly from the
original SQL.

**Deliberately NOT changed:** the underlying `users` table rows, the main user list/search query,
or the webhook's write path — an admin needs to still be able to find and manually delete a leaked
audit account via this exact page, so those rows must remain visible/searchable; this fix only
stops them from corrupting the four stat tiles that are meant to describe the real membership base.

### Blast radius

`getAdminUserListStats()` has exactly one caller (`src/app/api/admin/users/route.ts`), which has
exactly one caller (`UserManagement.tsx`'s stats bar). No other code reads
`AdminUserListStats`/`computeAdminUserListStats`.

### Evidence

- Live repro: screenshot of `/admin/users` showing the exact contradiction above.
- Traced root cause via source read (`clerk-audit-user.mjs`'s default `publicMetadata`,
  `internal-audit-email.ts`'s `isInternalAuditEmail`, the webhook's selective skip), confirmed the
  real admin-authorization gate (`isAdminUser`/`adminFromJwtRole`) reads Clerk session-claim JWTs
  directly — **not** this Postgres mirror — so this was a dashboard-display bug, not a privilege
  escalation.
- 2 new regression tests in `admin-users.test.ts`: one reproducing the exact live shape (an
  audit-temp admin+premium row alongside real premium/free members must not inflate admins or
  suppress premium/free), one covering admin-bucket priority + the allowlist path.
- Full suite: 16990 pass / 0 fail / 3 pre-existing skips (unrelated). `tsc --noEmit` clean.
