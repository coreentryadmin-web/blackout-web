> **kind:** FINDING

## Admin tool-access PATCH silently dropped an invalid tool key/mode instead of rejecting it — FIXED

| **Status** | FIXED — PR TBD |

### Root cause

`PATCH /api/admin/users/[id]` parsed `body.toolAccess` with `parseToolAccessMap()`
(`src/lib/tool-user-access.ts`), whose contract is deliberately lenient: any unrecognized tool
key or mode value is silently dropped rather than rejected, because that same function also
reads back already-persisted Clerk `tool_access` metadata this app itself wrote (lenient-by-design
there, documented and tested in `tool-user-access.test.ts`: "parseToolAccessMap ignores unknown
keys and bad values").

The admin PATCH route is a different context — it receives operator-typed input and should
reject a malformed entry, not silently no-op it with a `200 ok` success response. This is the
same bug shape the immediately-preceding session round fixed for `body.tier` on the same route
(`parseTier`'s free-fallback is correct for Whop webhook data, wrong for admin-typed input —
`parseAdminUserTier` was added as the strict counterpart). The sibling route
`POST /api/admin/users/tools/bulk` already validates `tool`/`mode` strictly with explicit 400s
(and has its own detailed comment about a related NaN-limit footgun), which is what exposed the
asymmetry: the bulk route rejects a malformed tool key or mode, the single-user PATCH route
silently drops it.

### Evidence

Before the fix, `parseToolAccessMap({ larg0: "grant", vector: "nope" })` returns `{}` — every
entry silently discarded, no error surfaced, route returns `200 ok` as if the toolAccess patch
had been applied. A UI typo in a tool key, or a malformed direct API call, would read as success
while changing nothing.

### Blast radius

Only `PATCH /api/admin/users/[id]`'s `toolAccess` handling. `GET /api/admin/users/[id]` and
`POST /api/admin/users/tools/bulk` are unaffected (the GET path reads back already-stored
metadata via `getToolAccessForUserId`/`parseToolAccessMap`, correctly lenient there; the bulk
route already validates strictly).

### Fix

Added `parseAdminToolAccessPatch(raw): ToolAccessMap | undefined` (`src/lib/tool-user-access.ts`)
— returns `undefined` if the payload isn't a plain object, or if ANY key/value pair is
unrecognized, rather than silently filtering bad entries. Wired into the PATCH route: returns
`400 { error: "Invalid toolAccess — unrecognized tool key or mode" }` when validation fails,
matching the existing `role`/`tier` 400 pattern on the same route. `parseToolAccessMap` itself is
unchanged — its lenient contract is correct for its other (read-back) callers.

### Tests

`src/lib/tool-user-access.test.ts`: 4 new cases (accepts a fully valid patch; rejects an
unrecognized tool key; rejects an unrecognized mode; rejects a non-object payload).
RED→GREEN confirmed via temp-file swap. Full suite: `tool-user-access.test.ts` (8/8),
`admin-users.test.ts` + `admin/users/route.test.ts` + `admin/users/tools/bulk/route.test.ts`
(19/19 combined). Lint + `tsc --noEmit` clean.
