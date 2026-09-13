> **kind:** FINDING

## Night Hawk Legacy — `buildRecordSegment`'s `avg_return_pct` could fabricate a "+0.00%" when every scoreable row was unpriced — FIXED

| | |
|---|---|
| **Status** | FIXED |
| **Severity** | P2 (member/admin-facing track-record number, the same false-zero failure class this file has three prior documented incidents of) |
| **Lane** | Night Hawk Legacy |
| **Found** | 2026-09-13, aggressive improvement-hunting sweep per the standing v3 mandate |

### What was broken

`analytics.ts`'s `buildRecordSegment` (the per-methodology record slice served by
`GET /api/market/nighthawk/record` and rendered on `HawkRecordStrip.tsx`/`PlaybookBoard.tsx`)
computed `avg_return_pct` as:

```ts
avg_return_pct: scoreable.length > 0 ? avgReturn(scoreable) : null,
```

`avgReturn` maps every scoreable row through `realizedReturnPct` (which returns `null` when
`next_day_close` is missing, the entry is corrupt, or entry is `0`), filters out the nulls, and
averages what's left via `avgOf` — which **defaults to `0` for an empty array**. The
`scoreable.length > 0` guard only protects the "zero scoreable rows" case; it does nothing for the
case where scoreable rows EXIST but **none of them** happen to have a computable return (e.g. every
row's `next_day_close` is still unpopulated). In that case `avgReturn(scoreable)` silently returns
`0`, and `avg_return_pct` reports a fabricated **"+0.00%"** instead of the honest "no evidence yet."

This is the exact same false-zero failure class this file already has three documented, tested
fixes for on sibling functions:
- `winRate`'s own comment: a 20-row all-`"open"` sample used to render "0% win rate" on 68.2%
  profitable plays (live incident, 2026-08-06).
- `profitableRate`'s own guard + test: *"no priced rows → no rate, not a 0%."*
- `buildRecordSegment`'s own `win_rate: decided > 0 ? wins / decided : null` right next to the bug.

`avg_return_pct` was the one field in the same function that never got the equivalent fix.

### Reachability

A segment's `scoreable` set (rows that are not unfilled, not pulled, and not
stop-data-unavailable) can be non-empty while every row in it still lacks `next_day_close` — e.g.
a fresh methodology segment (right after `regrade-legacy.ts`/a grading-rule change promotes a batch
of rows) whose `'open'`-outcome rows haven't had their close price backfilled yet, or any segment
sliced narrowly enough (a short window, a brand-new tag) that its only rows are still
mid-grading. `isStopDataUnavailable` only excludes a row for a missing **stop** basis
(`session_high`/`session_low`); it says nothing about `next_day_close`, so this gap was real, not
theoretical.

### Fix

Compute the actual list of realized returns first (`scoreable.map(realizedReturnPct).filter(v =>
v != null)`), then gate `avg_return_pct` on **that** list's length, not `scoreable.length`:

```ts
const scoreableReturns = scoreable.map(realizedReturnPct).filter((v): v is number => v != null);
...
avg_return_pct: scoreableReturns.length > 0 ? avgOf(scoreableReturns) : null,
```

Byte-identical result whenever at least one row has a real return (same numbers, same rounding);
only the previously-silent all-null case changes, from `0` to `null`.

### What was deliberately left unchanged

`groupWithReturn`'s own `avg_return_pct` (used by a different, non-methodology-segmented caller)
keeps its existing `avgReturn`-with-0-default behavior — this file's own test
(`groupWithReturn emits win_rate: null for an empty cut`) explicitly pins `avg_return_pct: 0` for
that function on an empty input, a distinct, already-decided, already-tested contract for a
different consumer. This fix touches only `buildRecordSegment`, the one function whose own type
(`avg_return_pct: number | null`) and half-built guard already show the null-on-no-evidence intent
was meant to be there.

### Evidence

RED→GREEN: 1 new subtest fails against pre-fix code (`0 !== null`, confirmed via `git stash` on
`analytics.ts` alone), 2 new subtests (the false-zero case, and a mixed priced/unpriced case
proving the average still excludes the unpriced row rather than treating it as a zero return) pass
post-fix, all 26 subtests in the file green. Full suite (Node 20): 14101/14101 pass, 0 fail, 3
skipped. `npx tsc --noEmit`: clean.

### Blast radius

One field (`NighthawkRecordSegment.avg_return_pct`), consumed by
`GET /api/market/nighthawk/record` (already null-safe: `seg.avg_return_pct != null ? round(...) :
null`) and rendered by `HawkRecordStrip.tsx`. No schema/API shape changed — the field was always
typed `number | null`; this only completes the null path the type already promised.
