> **kind:** FINDING

## Admin "create user" route silently falls back an invalid `tier` to `"free"` instead of rejecting it — FIXED

| **Status** | FIXED — PR TBD (same cycle this finding was staged) |
|---|---|

### Root cause

`POST /api/admin/users/create` (`src/app/api/admin/users/create/route.ts`) already validates
`body.role` against an explicit allowlist (`parseAdminUserRole`, rejecting an unrecognized
value with a 400) but passed `body.tier` straight into `parseTier()` (`src/lib/tiers.ts`) at
three call sites (the Clerk `publicMetadata.tier`, the Postgres `upsertAdminUserRow` call, and
the audit-log `detail.tier` field).

`parseTier`'s contract is deliberately lenient: it coerces any unrecognized string — including a
simple typo — to `"free"` rather than erroring, because its other callers (e.g. a Whop webhook
payload, or legacy `"pro"`/`"elite"` aliases) need a safe default for external data they can't
fully control. That contract is correct for those callers and wrong here: an admin typing
`tier: "Premium"` (wrong case) or any other malformed value while creating a new member account
got a 201 success response and a brand-new account silently created on `"free"`, with zero
indication anything was wrong — the operator would only discover it later when the new member
reports they aren't getting premium access.

This is the same bug shape found twice already this cycle on the SIBLING `PATCH
/api/admin/users/[id]` route (`parseTier` on the tier field, `parseToolAccessMap` on the
tool-access field) — this is a third instance of the identical class, on the user-CREATE route
this time.

### Evidence

RED→GREEN via `node:test`, confirmed locally:
- Pre-fix: no `isValidCreateUserTier` export existed; the equivalent test failed with
  `TypeError: ... is not a function`.
- Post-fix: `src/lib/admin-users.test.ts` — 9/9 pass (7 pre-existing + 2 new:
  "isValidCreateUserTier accepts only the canonical tiers",
  "isValidCreateUserTier rejects legacy aliases and malformed values").
- `npx tsc --noEmit` clean, `npx eslint` clean on all three touched files.

### Blast radius

Single route, single field (`tier`) — `role` on this same route was already strict; no other
field on this route accepts an enum-like value.

### Fix rationale

Added `isValidCreateUserTier()` to `src/lib/admin-users.ts` (not `src/lib/tiers.ts`, to avoid
widening `parseTier`'s own intentionally-lenient contract for its other callers), mirroring the
`role` field's existing validation shape in the same route: `tier` is optional (unset ⇒ default
to `"free"` via the existing `parseTier(tier)` calls, unchanged), but if a value IS supplied it
must be one of the three canonical tiers or the route 400s with
`"Invalid tier — use free, community, or premium"` before any Clerk/Postgres write happens.

Named `isValidCreateUserTier` (not `parseAdminUserTier`) and appended at the end of
`admin-users.ts` rather than near `parseAdminUserRole`, specifically to avoid colliding with the
similarly-named, same-cycle, still-unmerged `parseAdminUserTier` fix on the sibling PATCH route —
a deliberate naming/placement choice to keep the two fixes mergeable independently of merge
order. A future cleanup pass could consolidate both into one shared strict-tier validator once
both are on `main`, but that consolidation is out of scope for this fix.

Did not add a route-local export: Next.js's generated route-handler types reject any export from
a `route.ts` file other than the recognized HTTP-verb handlers and a small fixed set of config
exports (confirmed via a real `tsc` error: `Property 'isValidCreateUserTier' is incompatible with
index signature`), so the validator lives in the shared lib file per the repo's existing
convention (matching where `parseAdminUserRole` already lives).
