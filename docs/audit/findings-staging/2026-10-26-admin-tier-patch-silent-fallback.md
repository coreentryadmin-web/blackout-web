> **kind:** FINDING

## Admin user PATCH silently coerced an invalid `tier` to "free" instead of rejecting it — FIXED

| | |
|---|---|
| **Status** | FIXED |
| **PR** | (this branch) |

### Root cause

`PATCH /api/admin/users/[id]` (`src/app/api/admin/users/[id]/route.ts`) validates `body.role`
against an explicit allowlist (`parseAdminUserRole`, returns `undefined` on an unrecognized
value, route 400s) but had no equivalent check for `body.tier` — it passed the raw value straight
into `parseTier()` (`src/lib/tiers.ts`).

`parseTier`'s contract is deliberately lenient: it coerces ANY unrecognized string to `"free"`
rather than erroring, because its other callers (e.g. a Whop webhook payload) need a safe default
for external data they can't fully control. That contract is wrong for an admin mutation: a typo,
a stale/removed alias, or a malformed request body would silently set the target member's tier to
`"free"` and the route would still return 200 success — an admin editing a member's tier could
unknowingly demote them with no error surfaced anywhere.

The existing admin UI (`UserManagement.tsx`) only ever sends one of the three canonical values via
a `<select>`, so this was never reachable through the shipped UI — but the API route itself is the
real trust boundary (any direct API call, future UI change, or script hitting this endpoint is not
constrained by that one component's markup), and CLAUDE.md's own `parseTier` doc comment already
flags one prior, confirmed incident of exactly this "lenient-coercion contract used somewhere that
needed strict validation" bug shape (the `useAppAuth().tier === "admin"` case) — this is the same
root cause recurring in a second, more consequential call site (an admin write, not a client read).

### Fix

Added `parseAdminUserTier()` (`src/lib/admin-users.ts`), mirroring `parseAdminUserRole`'s shape:
accepts only `"free" | "community" | "premium"`, returns `undefined` on anything else. Wired into
the PATCH route right next to the existing role check — `"tier" in body` with an invalid value now
400s with `"Invalid tier — use free, community, or premium"`, matching the role check's pattern
exactly. The GET handler's own `parseTier(meta.tier)` (reading already-trusted Clerk metadata, not
user input) is untouched — only the user-input write path changed.

### Evidence

New test `parseAdminUserTier accepts only the three canonical tiers, rejects everything else`
(`src/lib/admin-users.test.ts`) — RED on pre-fix code (export didn't exist), GREEN post-fix (8/8).
Full admin-users + admin/users route test suite: 13/13 pass. Lint + `tsc --noEmit` clean.

### Blast radius

Single call site (`PATCH /api/admin/users/[id]`). No other route reads `body.tier` without going
through this same handler.
