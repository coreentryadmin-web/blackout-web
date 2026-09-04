## `spx-signal-weight-optimize` cron threw an uncaught `RangeError` on `?days=` (empty) or `?days=abc`, invisible to `cron_job_runs` — FIXED

> **kind:** `FINDING`

| | |
|---|---|
| **Status** | FIXED |
| **Severity** | P2 (silent cron failure — no live risk, but the nightly signal-weight report can fail with zero audit trail) |
| **File** | `src/app/api/cron/spx-signal-weight-optimize/route.ts`, regression test `src/app/api/cron/spx-signal-weight-optimize/route.test.ts` |
| **Found by** | Prior audit code-read, verified and fixed this session, 2026-09-04 |

### Root cause

The `?days` query-param parse had no NaN/empty-string guard:

```ts
const lookbackDays = parseInt(
  req.nextUrl.searchParams.get("days") ?? String(DEFAULT_LOOKBACK_DAYS),
  10
);
const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString();
```

`URLSearchParams.get()` returns the **empty string** `""` (not `null`) for `?days=` or a bare
`?days` — `??` only falls back on `null`/`undefined`, so it never fires and `parseInt("", 10)` is
`NaN`. The identical `NaN` results from any non-numeric value, e.g. `?days=abc`. That `NaN` flowed
straight into `Date.now() - NaN * 24*60*60*1000` → `new Date(NaN)` → `.toISOString()`, which
**throws** `RangeError: Invalid time value`.

Crucially, this computation sits **above** the route's own `try { ... } catch` block, so the throw
was never caught by this route's own error handling and `logCronRun` was never called for the
failure — the request crashed with Next.js's generic error response, invisible to
`cron_job_runs`/`cron-staleness-watchdog` (a failed query and a genuinely-never-ran job look
identical from that table alone).

This was a real regression relative to the codebase's own established convention: sibling crons
accepting the identical kind of numeric override already guard against exactly this —
`largo-cleanup/route.ts` (`daysParam ? Number(daysParam) : default`, a truthy check specifically
because empty-string is falsy) and `nighthawk-outcomes/route.ts` (`Number.isFinite(rawDays) &&
rawDays > 0 ? rawDays : 14`, with an in-code comment already explaining the exact same NaN trap for
a Postgres `$1::int` bind). `spx-signal-weight-optimize` was the one cron of this family that never
got the guard.

### Failure scenario

An operator or an audit/debug script calls `GET /api/cron/spx-signal-weight-optimize?days=` (empty
value) or `?days=abc` (typo) with a valid `CRON_SECRET` Bearer token. Instead of the default 30-day
lookback or a clean validation error, the request throws `RangeError: Invalid time value` before
any of the route's own error handling runs, returns a generic Next.js 500 with no diagnostic
payload, and `logCronRun` never fires — so the failure never appears in `cron_job_runs` and the
nightly signal-weight report silently fails to update, with no observable audit trail beyond a raw
stack trace in ECS logs.

### Fix

Split the parse from the validated value and apply the exact `nighthawk-outcomes` idiom
(`Number.isFinite(...) && ... > 0`, else default) — chosen over `largo-cleanup`'s truthy-string
check because this route already runs `parseInt` (not `Number`) and the fallback needs to reject
zero/negative too, which the finite-and-positive check does directly:

```ts
const rawLookbackDays = parseInt(
  req.nextUrl.searchParams.get("days") ?? String(DEFAULT_LOOKBACK_DAYS),
  10
);
const lookbackDays = Number.isFinite(rawLookbackDays) && rawLookbackDays > 0
  ? rawLookbackDays
  : DEFAULT_LOOKBACK_DAYS;
const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString();
```

Now `?days=`, a bare `?days`, and `?days=abc` all cleanly fall back to `DEFAULT_LOOKBACK_DAYS` (30)
instead of crashing; a valid numeric override (e.g. `?days=5`) still works unchanged.

### Evidence (RED → GREEN)

Added `route.test.ts` mocking `isCronAuthorized`, `requireDatabaseInProduction`, `dbQuery`,
`logCronRun`, and `spx-signal-db`'s `initSpxSignalTables`/`insertWeightReport` (pattern from
`spx-issues-sync/route.test.ts`). Before the fix, `?days=`, `?days=abc`, and a bare `?days` all
failed the test with:

```
error: 'Invalid time value'
name: 'RangeError'
stack: Date.toISOString (<anonymous>)
      GET (.../spx-signal-weight-optimize/route.ts:43:75)
```
(3 of 5 subtests failed — `not ok 2`, `not ok 3`, `not ok 5`, confirmed with the pre-fix route via
`git stash`.)

After the fix, all 5 subtests pass (`# pass 5 / # fail 0`) — the empty/non-numeric/bare cases now
return a clean `200` with `body.reason` naming `last 30 days` (the default), and a valid override
(`?days=5`) still reaches `last 5 days`. `npx tsc --noEmit` is clean.

### Blast radius

Single call site — `lookbackDays` is used only within this route (the `since` cutoff, the report's
`lookback_days` field, and `insertWeightReport`'s first argument). No other route imports or
duplicates this parse; `largo-cleanup` and `nighthawk-outcomes` already had their own correct guards
and needed no change.

### What was deliberately left unchanged

- The default value itself (`DEFAULT_LOOKBACK_DAYS = 30`) and the overall route behavior for a
  valid numeric `?days` override — unchanged.
- No new HTTP-level input validation (e.g. a `400` for a malformed `days`) was added; per the
  sibling routes' own convention, a malformed override silently falls back to the default rather
  than failing the request — consistent with `largo-cleanup`'s behavior for a non-numeric string
  (`Number("abc")` is `NaN`, which fails its own `Number.isFinite` check the same way and also falls
  through... actually `largo-cleanup` returns `400` in that case; `nighthawk-outcomes` silently
  defaults). This fix follows `nighthawk-outcomes`'s silent-default idiom specifically, since this
  cron already has an existing "insufficient data" soft-skip response shape and a `400` would be a
  larger behavioral change than the bug being fixed warrants.
