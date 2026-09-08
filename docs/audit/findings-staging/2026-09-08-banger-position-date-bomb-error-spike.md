> **kind:** `FINDING`

## `mapBangerPositionRow` served every banger position's session_date/expiry as a garbled, year-less label — causing a live P0 error spike on the ~1s live-marks poller — FIXED

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Area** | `src/lib/banger/positions-db.ts` (Engine B / banger open-book row mapping, feeding the shared 0DTE+swing live-marks poller) |
| **PR** | (pending — `fix/banger-position-date-bomb`) |

### Symptom (live, active incident)

Operator flagged a recurring `#🚨🔴 Prod error spike` alert in the ops Discord/Slack channel:
`2087` / `2040` / `2029` error(s) in consecutive 15-minute windows, all grouped under
`db_query/UPDATE zerodte_setup_log SET status = CASE WHEN status = 'CLOSED' THEN status WH…` — a
truncated scope (the watchdog's `error-sink.ts` groups by `(source, scope)`, where `scope` is the
raw SQL text sliced to 80 chars). Queried `GET /api/admin/errors` live: every one of the last 100
`error_events` rows carried the identical message shape:

```
invalid input syntax for type date: "Wed Aug 19"
invalid input syntax for type date: "Fri Sep 04"
invalid input syntax for type date: "Tue Aug 11"
... (8 distinct dates observed across a 100-row sample, spanning 2026-08-11..2026-09-04)
```

`created_at` on these rows clustered within <1 second of each other at query time — the incident
was live and ongoing, not a stale/resolved burst the decreasing 15-min counts in the alert made it
look like (the count decreases only because the rolling window ages out the earlier part of a
*continuous*, not a one-time, failure).

### Root cause

`src/lib/db.ts`'s `updateZeroDteLiveState(sessionDate, ticker, ...)` binds `sessionDate` to
`$1::date` in `WHERE session_date = $1::date`. This is called from the shared ~1s live-marks
poller (`runZeroDteMarkTick`, `src/lib/zerodte/live-marks.ts:667,694`) for every entry in its
merged `entered` play list — which includes not just 0DTE plays but also open banger/swing
positions merged in by `mergeSwingActivePlays` (`src/lib/swing/live-marks-active.ts`), specifically
so they ride the same quote/mark infrastructure.

`bangerRowToActivePlay()` (`live-marks-active.ts:44`) passes `session_date: row.session_date`
straight through from a `BangerPositionRow`, which is built by `mapBangerPositionRow()`
(`positions-db.ts:78-90`) directly off the RAW `dbQuery` result — **no prior normalization pass**,
unlike the sibling swing mapper (`mapSwingPositionRow`, `db.ts:7327`, which already calls
`isoDateString(r.session_date)` correctly). `mapBangerPositionRow` instead did:

```ts
session_date: String(r.session_date).slice(0, 10),
contract_expiry: String(r.contract_expiry).slice(0, 10),
```

node-postgres hands a `DATE` column back as a raw JS `Date` (no `setTypeParser` override anywhere
in this repo — documented at length in `db.ts`'s own `isoDateString`/`isoTimestampString` JSDoc).
`String(date)` runs `Date.prototype.toString()` — `"Wed Aug 19 2026 00:00:00 GMT+0000 (Coordinated
Universal Time)"` — and slicing the first 10 characters yields `"Wed Aug 19"`: a year-less,
weekday-first label that is not a valid date literal to Postgres at all. This is the exact bug
class `db.ts`'s `normalizeIsoDateInput()` already documents in its own JSDoc (*"a non-ISO string
(e.g. the legacy year-stripped `String(Date).slice(0,10)` label 'Mon Jun 29') makes Postgres throw
`invalid input syntax for type date`"*) and that `rejection-session-date.test.ts` already regression-
tests for a *different* call site (`admin-zerodte-health.ts`, fixed 2026-08-07) — this is the same
defect recurring in code that test does not cover.

Every open banger position hits this on every ~1s poll tick (plus the heartbeat re-persist),
which is exactly the observed volume: 2000+ `error_events` rows per 15-minute window, one per
(open banger position × tick).

### Blast radius

Same function, same root cause, one more field: `contract_expiry` used the identical
`String(r.contract_expiry).slice(0, 10)` pattern. Its garbled value flows into
`GET /api/market/banger/board` (`src/app/api/market/banger/board/route.ts:25`), Discord trade
notifications (`src/lib/banger/discord-trade-notify.ts:90`), and DTE math
(`src/lib/swing/banger-lane-merge.ts:42`'s `calendarDte(sessionYmd, row.contract_expiry)`) — a
member-visible or trade-logic-relevant garbled expiry date wherever a banger position's expiry is
shown or compared, not just an internal-only field. Fixed at the same call site.

Also fixed the TIMESTAMPTZ twin of the same bug on the same four lines: `first_seen_at`,
`committed_at`, `closed_at`, `updated_at` all used `String(r.field)` directly on what
node-postgres also hands back as a raw `Date` for `TIMESTAMPTZ` — the exact scenario `db.ts`'s
`isoTimestampString()` JSDoc documents (captured live 2026-08-07 on a different table). These
don't throw at the DB boundary (nothing binds them back into a `::date`/`::timestamptz` param),
but they still leak the same non-ISO, locale/TZ-dependent, second-resolution-only strings to any
consumer (API responses, Discord messages) — same root cause, same fix, same file, so fixed
together rather than leaving a second latent instance right next to the one that paged.

`occSymbolFromSwingRow()` (the OCC builder banger/swing rows share) was checked and confirmed
**not** affected — it uses only the stored `contract_occ`, never reconstructing from
strike/expiry, so the garbled `contract_expiry` never corrupted a live options symbol.

### Fix

`mapBangerPositionRow()` now uses the same helpers every other row mapper in this codebase already
uses for this exact purpose: `isoDateString()` for `session_date`/`contract_expiry` (`DATE` columns
→ `YYYY-MM-DD`), `isoTimestampString()` for the four timestamp columns (`TIMESTAMPTZ` → ISO 8601).
No behavior change for the (majority, in tests) case where the driver happens to hand back an
already-ISO string — both helpers pass that through unchanged.

### Evidence

- Live: `GET /api/admin/errors?limit=100` — 100/100 recent rows were this exact failure, 8 distinct
  malformed dates, confirming the bug is live and high-volume, not historical.
- `npx tsx --test src/lib/banger/positions-db.test.ts`: 4/4 pass, including a new regression test
  constructing a real `Date` (matching what node-postgres actually returns) and asserting the
  mapped row is clean ISO on all six affected fields.
- RED→GREEN proven via `git stash` on `positions-db.ts`: the new regression test fails
  (`actual: 'Wed Aug 19'`) against the pre-fix source, passes after.
- `npx tsc --noEmit`: clean.
- Full suite (Node 20): **13303 pass / 0 fail / 3 skipped**.
