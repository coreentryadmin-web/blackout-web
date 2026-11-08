> **kind:** FINDING

## `countAuthFailures` reported `total_24h` as the bounded sample's row count, silently capping the real total at 200 — FIXED

| | |
|---|---|
| **Area** | `src/lib/error-sink.ts` — BIE "security warnings / auth failure monitoring" (Stage 3), surfaced on `GET /api/admin/bie-report` as `auth_failures.total_24h` |
| **Status** | FIXED |
| **Files** | `src/lib/error-sink.ts`, `src/lib/error-sink.test.ts` |

### Root cause

`countAuthFailures(sinceHours)` queried `error_events` for `source = 'auth_failure'` rows with
`ORDER BY id DESC LIMIT 200`, then derived the headline `total_24h` field directly from
`rows.length` — the length of that same `LIMIT 200`-bounded array:

```ts
const { rows } = await dbQuery(/* ... ORDER BY id DESC LIMIT 200 */);
...
return {
  total_24h: rows.length,   // <-- BUG: can never exceed 200, no matter the real count
  by_mode,
  recent_messages: [...new Set(rows.map((r) => r.message))].slice(0, 5),
};
```

The `LIMIT 200` exists to bound the SAMPLE used for `by_mode`'s breakdown and
`recent_messages`'s preview — both are explicitly described in the file's own doc comments as a
small, recent sample, never meant to be exhaustive. But `total_24h` is the one field in this
summary that IS meant to be an exact, exhaustive count: it's the number an admin reads off the BIE
report's "security warnings" panel to judge whether there's a real auth-failure spike (brute-force
or credential-stuffing attempt) in the last 24 hours. Deriving it from `rows.length` meant any
window with **more than 200** real auth failures reported a flat, wrong `200` — understating the
true magnitude by however much the real count exceeded it, and doing so silently (no error, no
`available: false`, just a plausible-looking number that happens to be wrong). This is exactly the
scenario — a real spike well past 200 in 24h — where the number matters most for triage severity,
and exactly the kind of silent-undercount-as-fact failure mode this codebase's audit discipline
(the "absence principle," "never fabricate," never let a sampled/limited read masquerade as a
total) explicitly exists to catch elsewhere; this one instance of the pattern had not yet been
caught.

### Evidence

Added `shapeAuthFailureSummary(totalCount, rows)`, a pure function extracted from
`countAuthFailures` so the invariant ("`total_24h` must be the real count, not `rows.length`") is
unit-testable without a live Postgres connection. New regression test
(`shapeAuthFailureSummary: total_24h reflects the REAL total, not the bounded sample's length`)
passes a 200-row sample alongside a real count of 450 and asserts `total_24h === 450`, explicitly
asserting it is NOT `sampleRows.length` (200) — the exact shape of the live bug.

RED→GREEN proven locally: with the test added but `error-sink.ts` reverted to its pre-fix body
(`git stash` on just that file), `npx tsx --experimental-test-module-mocks --test
src/lib/error-sink.test.ts` fails 3 of the new tests with
`(0 , import_error_sink.shapeAuthFailureSummary) is not a function` (the function didn't exist
pre-fix — the old code had no seam to test the invariant against at all). Restoring the fix: all
11 tests in the file pass, 0 failures.

### Blast radius

`countAuthFailures` has exactly one call site repo-wide
(`src/app/api/admin/bie-report/route.ts`, Stage 3 of the BIE report), and its output flows straight
through to the JSON response's `auth_failures` field with no other transformation — so this is the
only consumer affected, and the fix closes the gap for all of it. `by_mode` and `recent_messages`
are unchanged in behavior (still derived from the same bounded 200-row sample, which is correct for
a "breakdown"/"preview" — only the headline total was wrong).

### Fix rationale

Run a real, unbounded `SELECT COUNT(*)::text AS count FROM error_events WHERE source =
'auth_failure' AND created_at > NOW() - ($1 || ' hours')::interval` alongside the existing bounded
sample query (both fired via `Promise.all`, so this adds one extra lightweight aggregate query, not
an extra round trip in sequence), and feed that real count — not `rows.length` — into the new pure
`shapeAuthFailureSummary` helper. Deliberately left `by_mode`/`recent_messages` sourced from the
same 200-row sample: they are explicitly a bounded breakdown/preview by design (per the function's
own pre-existing doc comment), not a total, so there is no equivalent bug to fix there — only
`total_24h`, the one field actually named and consumed as a total, needed the real count.
