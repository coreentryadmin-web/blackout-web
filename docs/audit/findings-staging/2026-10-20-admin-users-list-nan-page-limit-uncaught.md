## 2026-10-20 — [FINDING, P3 Input-validation] A malformed `page`/`limit` query param on the admin users list reaches Postgres/Clerk as NaN with no try/catch anywhere — FIXED

> **kind:** FINDING

**Context.** DISCOVERY-lane input-validation sweep, third fix from the same sweep that
produced the `?? default`-survives-NaN PR and the admin/users bulk-tool-access PR. This one
is a third distinct shape: the existing `||` guard only protects against an *empty* string,
not a *non-numeric* one, and the resulting `NaN` has nowhere to be caught.

**Root cause.** `src/app/api/admin/users/route.ts:74-75` (before this fix):
```js
const page = Math.max(1, Number(url.searchParams.get("page") || "1"));
const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") || "50")));
```
`url.searchParams.get("page") || "1"` only fires its fallback when the param is absent or an
*empty* string — `page=abc` returns the truthy string `"abc"`, so the fallback never runs.
`Number("abc")` = `NaN`, and `Math.max(1, NaN)` is itself `NaN` (NaN compares `false` against
everything, including the `1` floor), so `page = NaN`. `offset = (page - 1) * limit` (line
79) is then also `NaN`. The entire `GET` handler (lines 61-144) has **no try/catch
anywhere**, so this `NaN` flows uncaught into either `listClerkUserIdsByDbFilters(filters,
limit, offset)` (`src/lib/admin-users.ts` — binds `offset` as a raw Postgres `OFFSET $N`
parameter) or `client.users.getUserList({ limit, offset, ... })` (Clerk Backend API),
whichever branch `shouldUseDbAdminUserList(filters)` selects — both reject a `NaN` numeric
parameter, and the resulting exception propagates as a generic framework 500 instead of this
route's normal JSON response shape.

**Fix.** Added a second guard after `Number(...)` at both sites — `|| 1` for `page`, `|| 50`
for `limit` — matching the idiom used in the sibling fixes from the same sweep. `NaN` is
falsy, so this second guard catches exactly the case the first (empty-string-only) one
misses, without changing behavior for any already-valid input.

**Blast radius.** Single call site in this file — `page`/`limit` are read nowhere else.

**Evidence of fix.** New test `src/app/api/admin/users/route.test.ts` (no prior test file
existed for this route) asserts both guards are present. RED→GREEN proven via `git stash` on
just `route.ts`: fails on the pre-fix source (`not ok 1`), passes once the fix is restored.
`tsc --noEmit` clean.

**What was deliberately left unchanged.** The other two findings from the same sweep
(`2026-10-20-nan-limit-survives-nullish-coalescing.md`'s 3 sites, and
`2026-10-20-admin-bulk-tool-access-nan-limit-noop.md`) are separate root causes/fixes, each
shipped in their own PR.
