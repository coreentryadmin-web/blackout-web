> **kind:** FINDING

## Admin `page`/`limit` query params crash on a fractional value, not just a non-numeric one — FIXED

| **Status** | FIXED — PR #TBD |

### Root cause

`src/app/api/admin/users/route.ts` already guards its `page`/`limit` query params against a
non-numeric value (`page=abc`) with a double-`||` fallback chain, added in an earlier
DISCOVERY-lane pass (2026-10-20): `Number("abc")` is `NaN`, which survives `Math.max`/`Math.min`
unchanged (`NaN` compares `false` against everything), so a second `|| 1`/`|| 50` after the
`Number(...)` call catches it.

That guard does **not** cover a *fractional* value (`page=1.5`, `limit=50.7`). `Number("1.5")`
is `1.5` — finite, non-zero, truthy — so it survives both `||` fallbacks and both
`Math.max`/`Math.min` calls completely unchanged. `page`/`limit` then flow into
`offset = (page - 1) * limit` and from there into `listClerkUserIdsByDbFilters`
(`src/lib/admin-users.ts`), which binds them directly as raw `LIMIT $N OFFSET $N` parameters in
parameterized SQL with no explicit cast. PostgreSQL's `bigint` text-input parser (`int8in`) rejects
any string containing a decimal point outright (`invalid input syntax for type bigint: "1.5"`) —
unlike an explicit `CAST(... AS bigint)`, which rounds, the implicit type inferred for a bound
`LIMIT`/`OFFSET` parameter goes through the strict input function, not the cast path. The result is
an uncaught exception inside the DB call, with no `try`/`catch` anywhere in this handler — the same
failure shape (uncaught 500 instead of a graceful default) the NaN fix from 2026-10-20 already
fixed for the *non-numeric* case, just left open for the *fractional* one.

### Blast radius

The same root-cause shape (a `Number(...)`-parsed query param, guarded against `NaN` but not
against a fraction, flowing into a raw SQL `LIMIT` bind) was also present in
`src/lib/error-sink.ts`'s `fetchRecentErrorEvents`, called from `src/app/api/admin/errors/route.ts`:
`Math.min(Math.max(1, limit), 500)` preserves a fraction exactly the same way. Checked every other
non-owned-lane call site that binds a query-param-derived number into a raw SQL `LIMIT`/`OFFSET`
(`admin/incidents` — hardcoded `30`, not user-controlled; `admin/x-intel/queue` — already uses
`parseInt` + `Math.round`, safe; `market/vector/pick-closures/board` — already uses
`Math.round(limitRaw)`, safe) — these two were the only two still vulnerable.

### Fix

- `src/app/api/admin/users/route.ts`: wrapped both `page` and `limit`'s inner `Number(...) || default`
  expression in `Math.trunc(...)`, truncating any fraction to an integer before the outer
  `Math.max`/`Math.min` clamp runs (minimal diff, same nested-call style already used).
- `src/lib/error-sink.ts`: extracted the inline clamp into an exported, independently-tested pure
  function `clampErrorEventsLimit(limit)` — non-finite input falls back to `100` (matching the
  prior inline behavior), otherwise `Math.trunc`s before clamping to `[1, 500]`. The route now
  passes the raw parsed value straight through, since the pure function owns the full guard.

### Fix rationale

Truncating (not rounding) matches `parseInt`'s existing truncation-towards-zero semantics used
elsewhere in this exact file family (`admin/x-intel/queue/route.ts`), keeping the fix's behavior
consistent with the established sibling pattern rather than introducing a third rounding
convention. Extracting `clampErrorEventsLimit` as its own exported function (rather than fixing
the `error-sink.ts` clamp inline, as was done in `admin/users/route.ts`) follows this file's own
existing test convention — `error-sink.test.ts` already unit-tests several of this module's pure
helpers directly — and makes the fix independently verifiable without a live DB connection, which
this sandbox doesn't have.

### Evidence

New regression tests (both fail pre-fix, pass post-fix — `git stash` RED→GREEN confirmed):
- `src/app/api/admin/users/route.test.ts`: new source-regex test asserting `Math.trunc(...)` wraps
  both `page` and `limit`'s expressions.
- `src/lib/error-sink.test.ts`: 4 new direct unit tests for `clampErrorEventsLimit` covering
  fractional truncation, `[1,500]` clamping (including fractional out-of-range values), non-finite
  fallback, and well-formed pass-through.

`npx eslint` and `npx tsc --noEmit` both clean on all 5 changed files.
