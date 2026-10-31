> **kind:** FINDING

## `parseNextEarningsFromBenzinga` can report an ALREADY-REPORTED same-day print as "next earnings" — FIXED

**Status:** Fixed in this PR (`fix/meridian-next-earnings-already-reported`).

### Root cause

`src/lib/meridian/meridian-benzinga-earnings-core.ts`'s `parseNextEarningsFromBenzinga` picked the
"next upcoming" row like this:

```ts
const upcoming = rows
  .filter((r) => r.date >= todayYmd)
  .sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? "").localeCompare(b.time ?? ""));
const row = upcoming[0];
```

The filter only bounds the row by **date**, never by whether the print has actually landed yet.
Benzinga leaves a same-day row's `date` unchanged after it reports — a same-day BMO print that
has already posted `actual_eps`/`actual_revenue` by, say, 7am ET still has `date === todayYmd` and
sorts to the front of `upcoming`. Until Benzinga calendars the *next* quarter's date (which can
take hours), that already-reported row is the only candidate `r.date >= todayYmd` returns, and the
function hands it back as the caller's "next earnings" — `found`-shaped output describing a print
that already happened as if it were still ahead, with `days_until: 0`.

This is the exact bug shape just fixed in `src/lib/meridian/meridian-ticker-lookup-core.ts`'s
`pickUpcomingEarningsRow` (#7100, merged on `main` as of this writing): a date-only "upcoming"
filter with no companion "has this printed yet" check. The two functions are siblings in the same
file family (`meridian-ticker-lookup.ts`/`-core.ts` vs `meridian-benzinga-earnings.ts`/`-core.ts`)
reading the same upstream `BenzingaStructuredEarnings` rows, but #7100 only touched the lookup
selector — this one was untouched and carried the identical defect.

The existing test (`"parseNextEarningsFromBenzinga picks nearest upcoming print"`) only exercised
a **PAST**-dated already-reported row (`date: "2026-05-01"` against `todayYmd: "2026-08-17"`),
which the date filter alone already excludes — it never covered a **TODAY**-dated already-reported
row, the actual gap.

### Blast radius

`parseNextEarningsFromBenzinga` is called from three places, all affected identically because none
apply an independent sanity check of their own:

1. `src/lib/meridian/meridian-benzinga-earnings.ts`'s `loadNextEarningsFromBenzinga` — Meridian's
   own earnings-calendar data path.
2. `src/lib/providers/uw-earnings.ts`'s `fetchNextEarningsUnified` — imports
   `loadNextEarningsFromBenzinga` as the FIRST-TRIED source (UW REST is only the fallback when
   Benzinga has no future row), so this is the primary "next earnings" signal for every caller of
   the shared `uw-earnings.ts` module across the app, not just Meridian.
3. `src/lib/largo/pre-earnings-pack.ts` and `src/lib/largo/run-tool.ts` (both under the excluded
   `src/lib/largo/` path, not touched by this PR) call `parseNextEarningsFromBenzinga` directly —
   they inherit the fix automatically once this shared core function is corrected, with no edit
   needed on their side.

### Evidence

RED→GREEN on `parseNextEarningsFromBenzinga`, two new regression tests in
`meridian-benzinga-earnings-core.test.ts`:

- Reverted to the old `r.date >= todayYmd` filter (no `actual_eps`/`actual_revenue` check) and ran
  `npx tsx --experimental-test-module-mocks --test src/lib/meridian/meridian-benzinga-earnings-core.test.ts`:
  **32 pass / 2 fail** — both new tests fail: a same-day already-reported row is wrongly returned
  as "next earnings" instead of the real next one, and a lone already-reported row with no future
  row on file returns that stale row instead of `null`.
- Restored the fix (`r.date >= todayYmd && r.actual_eps == null && r.actual_revenue == null`):
  **34/34 pass.**
- `npx tsc --noEmit` clean.
- `npx tsx --experimental-test-module-mocks --test src/lib/meridian/meridian-benzinga-earnings.test.ts src/lib/providers/uw-earnings.test.ts` — 11/11 pass, no regressions in the two direct
  consumer modules this PR did not otherwise touch.
- Full `npm test` run — see PR CI.

### Fix rationale

Added `&& r.actual_eps == null && r.actual_revenue == null` to the existing `.filter(...)`, mirroring
both the field's own established meaning in this same file (`benzingaToCalendarRow`'s
`is_printed: row.actual_eps != null || row.actual_revenue != null`) and #7100's fix for the sibling
selector. Checking both fields (not just `actual_eps`) matches `is_printed`'s own OR — a print that
only reports revenue so far (or vice versa) should still count as "printed", not "upcoming".
Deliberately left unchanged: the date filter itself, the sort order, the `days == null || days < 0`
guard, and every other function in this file — this is a single, narrowly-scoped `.filter()`
predicate fix, not a rewrite of the selection logic.
