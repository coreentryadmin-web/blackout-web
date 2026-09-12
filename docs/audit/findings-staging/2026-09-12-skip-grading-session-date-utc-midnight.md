> **kind:** `FINDING`

# 0DTE skip-grading's `session_date` normalization silently fetches the WRONG day's bars — every row, every gate — FIXED

| Field | Detail |
|---|---|
| **Status** | FIXED |
| **Lane** | 0DTE Command / Night Hawk (skip-grading — the counterfactual "blocked value" grader) |
| **Severity** | P0 — structural, not small-sample: every one of the 18 hard-gate codes in `GET /api/market/zerodte/calibration`'s `blocked_value[]` read `n=0` graded outcomes on the Blocked side over a 90-day window (`docs/audit/0DTE-RESEARCH.md`'s "Gate-overlap ablation" section, 2026-09-10 run) — the counterfactual grader that is supposed to answer "what did the hard gates cost us?" has been silently producing zero usable evidence |
| **Files** | `src/lib/zerodte/skip-grading.ts` (`runSkipGrading`'s row-mapping), `src/lib/zerodte/skip-grading.test.ts` |
| **Prompted by** | `docs/audit/0DTE-RESEARCH.md`'s "Gate-overlap ablation" section's own NOT-YET-VERIFIED hypothesis (a different, adjacent field — see "Hypothesis investigated and REFUTED" below) |

## Root cause

`runSkipGrading` (`src/lib/zerodte/skip-grading.ts`) reads `zerodte_scan_rejections` rows and, for
each one, fetches that session's underlying minute bars (`barsFor(row.ticker, row.session_date)`)
to grade the counterfactual "would this blocked play have won?" — comparing the first bar
at/after the block instant (`blockedAtMs`) against later bars in the SAME session.

`session_date` is a plain Postgres `DATE` column (no time-of-day, no timezone — the scanner
already stamps it with the correct ET trading-day string at INSERT time, e.g. `'2026-07-10'`).
node-postgres hands a `DATE` column back to the application as a JS `Date` object anchored at
**UTC midnight** for that calendar day (this is standard, well-established pg behavior, already
documented at length elsewhere in this exact file — `src/lib/db.ts`'s `isoDateString` doc comment:
*"DATE has no timezone, midnight-UTC is the day"*).

The buggy line:

```ts
// session_date arrives as a Date object from pg — normalize to ET YYYY-MM-DD.
session_date:
  r.session_date instanceof Date ? etYmd(r.session_date.getTime()) : String(r.session_date).slice(0, 10),
```

`etYmd()` is built for converting a REAL epoch instant (e.g. `opts.nowMs`, an actual wall-clock
moment) into its America/New_York calendar day — correct for that use elsewhere in this same file
(the `since`/`today` window bounds). It is the WRONG operation for round-tripping a `DATE` column:
run the midnight-UTC instant for `DATE '2026-07-10'` through `etYmd()`, and because
America/New_York is **behind** UTC, midnight UTC is always still the *previous evening* in ET —
so `etYmd()` silently returns **`"2026-07-09"`** for every single row whose real, stored
`session_date` is `2026-07-10`. This is deterministic, not occasional: it happens on 100% of rows,
every day of the year (the UTC/ET offset is always negative for New York; the shift only ever
lands on the previous calendar day, never the same one).

That wrong date then drives the underlying-bar fetch (`fetchAggBarsWithDiagnostics`) to pull the
**wrong session's** minute bars — every bar timestamp returned is from the day BEFORE the row's
real session. `entryBarOf`'s scan (`if (bar.t < blockedAtMs) continue;`) then finds no bar at or
after `blockedAtMs` (which is correctly computed, on the real day) among bars that are all from the
prior calendar day — so it always returns `null`, and `gradeSkippedPlay` falls through to the
generic ungradeable reasons:

- `"no underlying bar at/after the block time inside the plan window"`
- `"no bar data available for the session — neither contract nor underlying path reconstructable"`

— exactly the two dominant reasons the 2026-09-10 research-doc run found across effectively every
ungradeable row, on every gate code, regardless of ticker or gate.

## Hypothesis investigated and REFUTED (do this before reading the fix)

The research doc's own not-yet-verified hypothesis blamed a DIFFERENT field: `blockedAtMs =
Date.parse(row.observed_at)`, theorizing that `observed_at` (a `TIMESTAMPTZ` column) round-trips
through Postgres without an explicit UTC marker and gets timezone-misinterpreted.

This was checked against the real code and **does not hold**:
- `zerodte_scan_rejections.observed_at` is declared `TIMESTAMPTZ NOT NULL DEFAULT NOW()` (`db.ts`)
  — a real instant column, not a naive timestamp.
- No `setTypeParser` override exists anywhere in this repo (confirmed by repo-wide grep) — pg's
  default parser hands `TIMESTAMPTZ` back as a genuine JS `Date` object representing the correct
  absolute instant, exactly as `db.ts`'s own `isoTimestampString` doc comment documents.
- `skip-grading.ts` does `observed_at: String(r.observed_at)` (i.e. `Date.prototype.toString()`),
  then later `Date.parse(row.observed_at)` in the SAME process. Verified empirically (`node -e`,
  three different process `TZ` settings — `UTC`, `America/New_York`, `Asia/Kolkata`): this
  round-trips to the **exact same epoch millisecond**, every time, in every zone, because
  `toString()` always embeds an explicit `GMT±HHMM` offset and V8's `Date.parse` is the exact
  inverse of its own `toString()` format. There is no timezone shift here — only sub-second
  truncation (irrelevant at minute-bar granularity).

So the specific mechanism the doc proposed is wrong, but the doc's broader instinct — "a
timezone/naive-timestamp bug in this exact function" — was right, just pointing at the sibling
field. This is why the task asked to trace the real code rather than assume the stated hypothesis:
tracing it found the real bug one field over.

## Evidence (RED → GREEN)

Added a regression test that supplies `session_date` in pg's REAL return shape — a JS `Date` at
UTC midnight, e.g. `new Date("2026-07-10T00:00:00.000Z")` — rather than the plain string every
prior hermetic test in this file used (which is why this shipped undetected: no existing test ever
exercised the actual pg-returned shape for this field).

**RED (pre-fix, `etYmd(r.session_date.getTime())`):**
```
Expected values to be strictly deep-equal:
  [ { from: '2026-07-09', symbol: 'NVDA' } ]   // actual — wrong day
  [ { from: '2026-07-10', symbol: 'NVDA' } ]   // expected — the row's real session_date
```

**GREEN (post-fix):** the underlying-bar fetch is issued for `2026-07-10` (the correct day), and
with real bars present at/after `blockedAtMs`, the row grades successfully (`graded: 1,
ungradeable: 0`) instead of landing on the generic "no bar data" reason.

Full suite: `npm test` (Node 20) — **13787 pass / 0 fail / 3 skipped**, unchanged pass count aside
from the two new assertions in this file. `npx tsc --noEmit` clean.

## Fix

Replace the ET-conversion with the same UTC-extraction idiom `src/lib/db.ts` already establishes
and exports for exactly this situation (`isoDateString` — "DATE has no timezone, read its UTC
Y-M-D"), rather than inventing a second implementation of the same fix:

```ts
session_date:
  r.session_date instanceof Date ? db.isoDateString(r.session_date) : String(r.session_date).slice(0, 10),
```

(`db` is already dynamically imported at the top of `runSkipGrading` for `dbQuery`/`dbConfigured`,
so this adds no new import surface.) The test file's `../db` mock gained a real, lockstep copy of
`isoDateString`'s logic so the hermetic test exercises the same normalization production does.

## Blast radius

Checked for the same `etYmd(<DATE-column>.getTime())` shape elsewhere in the 0DTE/swing/legacy
lanes (grep for `etYmd(` across `src/lib/zerodte/`, `src/lib/swing/`, `src/lib/nighthawk*` and
`src/features/nighthawk/`) — this is the only call site that feeds a `DATE`-typed column's
`Date` object into `etYmd()`. Every other `etYmd()` call in the codebase converts a real epoch
instant (`Date.now()`, `nowMs`, a `TIMESTAMPTZ` value), which is exactly what the function is for.

## What was deliberately left unchanged

- `observed_at`'s `String(Date) → Date.parse(string)` handling: verified correct (see above), not
  touched.
- `etYmd()` itself: correct for its actual real callers (`since`/`today` window bounds derived from
  `opts.nowMs`); not rewritten or removed.
- No gate threshold, scoring, or grading rule changed — this is purely a data-plumbing fix that lets
  the existing, already-correct `gradeSkippedPlay` core see the RIGHT day's bars. The counterfactual
  honesty rules (conservative ties, never fabricating a premium grade, `ungradeable` when truly not
  reconstructable) are untouched.

## Next step (not done here, flagged for the next audit cycle)

Once this ships and a fresh set of `zerodte_scan_rejections` rows is graded under the fix,
re-run `scripts/audit/zerodte-gate-primary-ablation.mjs --days=90` (or the calibration report's
`blocked_value[]` directly) — the gate-overlap ablation study that was blocked entirely by this bug
should now produce real Blocked-side win-rate/EV numbers instead of `n=0` across the board. Log
that re-check in `docs/audit/MARKET-OPEN-VALIDATION.md`.
