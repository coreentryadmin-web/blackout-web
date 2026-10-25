> **kind:** FINDING

## Swing `/record`'s `nativeOpens` silently undercounts a genuinely-open position when the `days` window predates its entry date — FIXED

| **Status** | Fixed (PR, see branch `fix/swing-record-open-position-window-blindspot`) |
|---|---|

### Root cause

`GET /api/market/swing/record`'s only source of candidate chain roots was
`fetchSwingPositionsRange(since, limit)` (`db.ts`), which filters
`WHERE session_date >= $1::date` — i.e. it only returns rows whose entry date
falls inside the caller's `days` lookback window. `selectSwingRecordRootIds`
(`record.ts`) correctly seeds a root for any row that is either GRADED
(closed/rolled) **or** currently `OPEN`/`HOLD`/`TRIM` — but it can only act on
whatever rows it is handed. A still-open native `swing_positions` row whose own
`session_date` (entry date) is older than `since` never reaches that function
at all, so its chain never enters `records`, and
`buildSwingRecordSummary`'s `opens = records.length - resolved.length` silently
undercounts.

"Is this position currently open" is a **present-tense fact**, not a historical
one that should depend on how far back `days` happens to look — `record.ts`'s
own `selectSwingRecordRootIds` doc comment already states this intent
verbatim ("currently OPEN/HOLD/TRIM ... a live, committed position"); the gap
was only ever in which rows the route handed to it, not in that function's own
logic.

### Evidence

Live-measured against production before the fix:

```
days=1  -> nativeOpens: 0
days=7  -> nativeOpens: 2
days=30 -> nativeOpens: 2
days=90 -> nativeOpens: 2
```

Two real native OPEN/HOLD/TRIM positions exist right now; querying with a
window shorter than their holding period makes them invisible to this route's
`opens`/`nativeOpens` count. The two production call sites
(`SwingAnalyticsPanel.tsx`, `command-deck/containers.tsx`) both use `days=30`,
and today's `HORIZONS.SWING.dteMax` (15) keeps an unrolled open leg's
`session_date` within 15 days of "now" — so this specific symptom is not
currently visible to members, but it is a live, reachable gap for:
- any audit/research script in this toolkit that queries a shorter window
  (several default to smaller `DAYS` values),
- the route itself the moment `dteMax`/a sub-lane's holding window widens
  again, or a position legitimately sits open longer than usual.

### Blast radius

Only this route (`src/app/api/market/swing/record/route.ts`) was touched —
`fetchSwingPositionsRange` itself is a shared accessor also used by
`play-brief-resolve.ts`, `horizon-outcomes.ts`, and the admin
`closed-position-snapshots` route, each with its own window semantics that
are NOT part of this bug (they are not computing a "how many are open right
now" count), so the function itself was deliberately left unchanged rather
than widened at the shared layer.

### Fix rationale

Added a second, **date-independent** fetch — `fetchOpenSwingPositions()`
(`db.ts`, already used elsewhere, e.g. `live-marks-active.ts`; filters
`status NOT IN ('CLOSED','ROLLED')`, no date bound at all) — and union its
seeded root ids with the window-bounded ones before building chains. This is
the minimal fix that preserves everything else about the route's existing
contract:
- `chains`/`resolved_chains`/`wins`/`losses`/`breakevens` stay exactly
  window-scoped, as intended (historical grading over `[since, through]`).
- `opens`/`nativeOpens` now correctly reflect every real OPEN/HOLD/TRIM
  position regardless of how old its own entry date is.
- Fail-soft: a failure on the new `fetchOpenSwingPositions()` call degrades to
  `[]` (the pre-fix behavior), matching this route's existing per-source
  fail-soft discipline (the banger-opens fetch a few lines below it).

### Tests

Added `src/app/api/market/swing/record/route.test.ts`: a genuinely-open
native row with a `session_date` far outside any `days=1..90` window,
`fetchSwingPositionsRange` mocked to return `[]` (simulating the window
missing it), `fetchOpenSwingPositions` mocked to return the open row — asserts
`summary.nativeOpens === 1`. RED→GREEN confirmed (fails `0 !== 1` before the
fix, passes after). Full existing coverage (`record.test.ts` +
`route.test.ts`, 18 tests) stays green; `npx tsc --noEmit` clean; full
`npm test` (Node 20): 16907 pass / 0 fail / 3 pre-existing skips.
