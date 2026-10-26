> **kind:** FINDING

## `admin/audit-log` 502s on a malformed `?limit=` query param instead of defaulting — FIXED

| | |
|---|---|
| **Status** | FIXED — PR TBD on open |
| **Severity** | P3 (admin-only route, availability only — no data exposure) |
| **Found by** | DISCOVERY lane, round 63, duplicate-logic sweep |

### Root cause

`src/app/api/admin/audit-log/route.ts:51` parsed the `limit` query param with a bare
`Math.min(100, parseInt(url.searchParams.get("limit") ?? "50", 10))`. `parseInt("abc", 10)`
(or any non-numeric value) returns `NaN`, and `Math.min`/`Math.max` against `NaN` always
return `NaN` — `NaN` compares `false` against everything, including itself, so neither
function's comparison can ever select the other operand. That `NaN` then flowed straight
into the raw SQL `LIMIT $N` parameter (`queryParams = [...filterParams, limit]`), and
Postgres rejects a non-integer `LIMIT` outright, so the route's `catch` block turned a
one-character query-string typo into an opaque `502 { error: "Failed to load audit log" }`
instead of the "default 50" behavior the code visually implies. The same bare value also had
no lower bound — `?limit=-5` or `?limit=0` passed straight through to the same crash.

### Evidence

Confirmed by RED→GREEN test (`route.test.ts`, source-text assertion against the real
pre-fix file via `git show origin/main:...`): both assertions failed against the unguarded
`parseInt` line and passed once replaced. This exact bug shape — a bare `parseInt`/`Number`
on a query param reaching an unguarded `Math.min`/`Math.max` chain — was already found and
fixed in a sibling route by an earlier DISCOVERY round (`admin/users/route.ts`, confirmed via
that route's own `route.test.ts`, dated 2026-10-20) and is the documented pattern at least 8
other limit-parsing routes already guard against correctly (`market/vector/pick-closures/board`,
`market/ticker-search`, `cron/alert-outcome-sync`, `admin/errors`, `market/spx/signals`,
`market/spx/outcomes`, `admin/zerodte/rejection-export`). This route was the one outlier still
using the unguarded form.

### Blast radius

Single call site — `admin/audit-log`'s own `GET` handler is the only place this `limit` value
is computed or used. Admin-only route (`resolveAdminApi` gate), so the practical impact is
limited to an admin seeing a confusing 502 instead of the audit log defaulting to 50 rows; no
data-exposure or cross-user angle (unlike the round-61 ticker-validation finding, this one
never reaches another user's data).

### Fix rationale

Replaced the bare `parseInt`+`Math.min` with the same `Number(...) `+ `Number.isFinite` guard
+ two-sided `Math.min(100, Math.max(1, ...))` clamp already used by the 8 sibling routes named
above — not a new pattern, just bringing this one route in line with the rest of the codebase.
Deliberately left the `action`/`actor` filter parsing untouched — they're plain string
filters with no numeric-coercion path, so they don't share this bug class.
