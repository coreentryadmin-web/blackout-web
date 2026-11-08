> **kind:** FINDING

## Night Hawk Vector pick-log board "Net premium" calendar tile diluted toward zero by rows with no usable premium — FIXED

| | |
|---|---|
| **Area** | Night Hawk (`src/features/nighthawk/lib/vector-board-table-utils.ts`) |
| **Status** | FIXED |
| **Severity** | P3 (display-only, but silently wrong on every day with an undated row) |

### Root cause

`vectorBoardCalendarBuckets` builds the per-session-day calendar tile shown by
`VectorPickLogBoard.tsx` (the "Net premium" figure + up/down/flat tone per day on the Vector pick
log board). For each row it accumulates a running `sum`/`n` pair and then averages:

```ts
const cur = map.get(row.sessionDate) ?? { sum: 0, n: 0, winners: 0, closed: 0 };
cur.n += 1;
if (row.premiumPct != null && Number.isFinite(row.premiumPct)) cur.sum += row.premiumPct;
...
const avg = v.n > 0 ? v.sum / v.n : 0;
```

`premiumPct` is explicitly nullable on both source types it is built from
(`VectorLeaderPlay.premium_pct_from_entry: number | null` and
`VectorClosurePlay.premium_pct_from_entry: number | null`,
`VectorPickLogBoard.types.ts`) — a freshly-surfaced live leader with no price yet, or a closed pick
that never got a fill, legitimately carries `premiumPct: null`. The `sum` accumulation already
guards against that (`row.premiumPct != null && Number.isFinite(...)`), but the **denominator**
(`n`) increments unconditionally for every row regardless of whether it contributed to `sum`. A
null-premium row therefore counts toward the average's divisor while contributing 0 to its
numerator, dragging the day's blended figure toward zero exactly as if that row had genuinely
returned 0% — the same dilution shape CLAUDE.md's "Systemic" note warns about for averages that
silently fold an absent value in as a measured zero.

Concrete repro: one real pick at **+100%** plus one undated live pick (`premiumPct: null`) on the
same `session_date` reads **"Net premium +50%"** instead of the honest **+100%** — the null row
exists, contributes nothing, and still halves the divisor.

This is not a new bug *class* in this codebase — it is the exact defect already found and fixed
twice in this same lane:

1. `vectorBoardScorecard`'s `netPremiumPct` (sibling file, `vector-board-row-utils.ts`) already
   divides by `pctN` (count of rows that actually had a usable `premiumPct`), not `rows.length` —
   deliberately, per that function's own inline comment about not letting a pulled/undated row's
   counterfactual or absence distort the blended figure.
2. `legacyBoardCalendarBuckets` (Night Hawk Legacy's sibling calendar-tile builder,
   `legacy-board-table-utils.ts`) was fixed for exactly this shape on 2026-09-15: "Averaging a null
   premium in as 0 silently dilutes a real winner/loser toward zero... Measured live 2026-09-15:
   VNCE (stock-only) +10-12% on the underlying, the day's only play — the tile read '+0%' pre-fix."
   That fix filters to `withPremium = resolved.filter((r) => r.premiumPct != null)` and divides by
   `withPremium.length`.

`vectorBoardCalendarBuckets` — the Vector desk's own version of the identical calendar tile, in the
sibling file right next to it — never received the equivalent fix. Two implementations of "average
today's premium across the board", one fixed, one not.

### Evidence (RED → GREEN)

Added a regression test to `vector-board-table-utils.test.ts`: one row at `+100%` plus one row with
`premium_pct_from_entry: null` / `peak_premium_pct: null` on the same session date.

RED (before the fix, `npx tsx --experimental-test-module-mocks --test
src/features/nighthawk/lib/vector-board-table-utils.test.ts`):
```
not ok 6 - vectorBoardCalendarBuckets excludes rows with no usable premium from the blended average
  Expected values to be strictly equal:
  50 !== 100
# tests 7
# pass 6
# fail 1
```

GREEN (after tracking a separate `premiumN` counter — incremented only alongside `sum` — and
dividing `avg` by `premiumN` instead of `n`):
```
ok 6 - vectorBoardCalendarBuckets excludes rows with no usable premium from the blended average
# tests 7
# pass 7
# fail 0
```

All 6 pre-existing tests in the file (including the pre-existing
`vectorBoardCalendarBuckets aggregates session tone` test, which has no null-premium rows and is
unaffected) still pass unchanged. `npx tsc --noEmit` clean.

### Blast radius

`vectorBoardCalendarBuckets` has exactly one call site repo-wide outside its own test file —
`VectorPickLogBoard.tsx`'s calendar strip, which feeds the per-day "Net premium" tile and its
up/down/flat tone directly from this function's return value. No other consumer duplicates this
exact averaging formula (grepped `vectorBoardCalendarBuckets` across `src/`). The sibling
`legacyBoardCalendarBuckets` (Night Hawk Legacy) and `vectorBoardScorecard`'s `netPremiumPct`
(Vector's own board-wide scorecard, not the per-day calendar) already divide by the premium-bearing
count and were not touched — they were already correct; this fix only brings
`vectorBoardCalendarBuckets` in line with them.

### Fix rationale

Added a `premiumN` field to the per-day accumulator, incremented only inside the same guard that
feeds `sum` (`row.premiumPct != null && Number.isFinite(row.premiumPct)`), and changed the average
to divide by `premiumN` instead of `n`. `n` itself is left untouched and still reports the true
total row count for that day (the bucket's own `n` field is a separate, intentionally-inclusive
count used elsewhere on the board — e.g. "N picks today" — and must not change). This mirrors
`legacyBoardCalendarBuckets`'s existing `withPremium`/`resolved` pattern exactly, so the two sibling
calendar-tile builders now agree on how an absent premium is handled, rather than one silently
treating it as a measured zero.
