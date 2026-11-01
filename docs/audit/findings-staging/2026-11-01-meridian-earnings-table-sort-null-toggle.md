> **kind:** FINDING

## Meridian earnings print ledger: toggling a sort column moved ungraded prints to the TOP, not the bottom — FIXED

**Status:** FIXED (PR, this round)

### Root cause

`MeridianEarningsTable` (`src/features/meridian/components/MeridianEarningsAnalytics.tsx`) is the
dense, sortable print ledger on the Meridian earnings analytics panels. Its `"eps_surprise"` /
`"rev_surprise"` column comparator special-cased a `null` surprise (an ungraded/unprinted row) to
always sort after any real value:

```ts
if (av == null && bv == null) return 0;
if (av == null) return 1;
if (bv == null) return -1;
return bv - av;
```

— matching the comment directly above it: *"Nulls always sort LAST regardless of direction."* But
the column's direction toggle negated the **entire** comparator, including those null branches:

```ts
list.sort((a, b) => (desc ? -cmp(a, b) : cmp(a, b)));
```

`cmp` only special-cased null placement for the *first* click (`desc === false`). The very next
click on the same header (`desc === true`, the normal "click again to flip direction" gesture)
negated the null branches along with the real-value branch, so `-1`/`1` flipped too — moving every
ungraded print from the bottom of the ledger to the **top**. The column's `aria-sort` attribute and
caret glyph (▾/▴) never reflected this: they only track the `desc` boolean, so the header kept
claiming a consistent, intentional direction while the actual placement of unknown rows silently
inverted underneath it.

### Evidence

Added `sortEarningsAnalyticsRows` to `src/lib/meridian/meridian-earnings-analytics-core.ts` (the
already-unit-tested core this component's own file header says all its arithmetic belongs in — the
sort comparator had drifted out of that file and into the untestable component, which is itself
part of why this went unnoticed) and reproduced the exact failure with a regression test before
fixing the null branches:

```
rows: eps_surprise_pct = [A: +5%, B: null, C: -3%]

desc=false (1st click):  [A, C, B]   -- correct: B (null) last
desc=true  (2nd click, buggy):  [B, C, A]   -- B (null) jumped to FIRST
desc=true  (2nd click, fixed):  [C, A, B]   -- B (null) still LAST; A/C just swapped
```

Confirmed RED→GREEN by temporarily reverting the fixed null branches back to the pre-fix
`return 1` / `return -1` literals and re-running the new tests: both
`sortEarningsAnalyticsRows`-based tests failed exactly as predicted (`not ok 17`/`18`, actual order
`['B','C','A']` instead of `['C','A','B']`), then passed again once the fix was restored. Full
`meridian-earnings-analytics-core.test.ts` run: 19/19 pass with the fix; full
`src/lib/meridian/*.test.ts` suite: 526/526 pass.

### Blast radius

Only one call site renders this table (`MeridianEarningsTable`, used from the Meridian earnings
History/Analytics tabs), and only the two surprise-percent columns (`"eps_surprise"`,
`"rev_surprise"`) had the asymmetric null handling — `"importance"` falls back `?? 0` (no
null-last promise to break) and `"date"`/`"ticker"` never carry nulls. No other component in the
codebase imports or duplicates this comparator.

### Fix rationale

Rather than special-casing the toggle at the call site, the null branches themselves were made to
depend on `desc` so they cancel out the caller's own `desc ? -cmp(a,b) : cmp(a,b)` negation:

```ts
if (av == null) return desc ? -1 : 1;
if (bv == null) return desc ? 1 : -1;
```

This keeps the existing single-comparator-plus-outer-negation architecture (no second code path
to maintain for `desc`) while making "null is always worst, regardless of direction" actually
hold under negation, not just before it. The sort logic was moved from the component into
`meridian-earnings-analytics-core.ts` as `sortEarningsAnalyticsRows` (exported, unit-tested, typed
via `EarningsTableSortKey`) rather than patched in place, per that file's own stated design rule
("Everything numeric here comes from meridian-earnings-analytics-core... any arithmetic living in
[the components] would be untestable by construction") — the sort comparator was the one piece of
arithmetic in this file that had not followed that rule, which is also why the bug went unit-tested
for every other transform in this file but not for this one.

### Files touched
- `src/lib/meridian/meridian-earnings-analytics-core.ts` — added `sortEarningsAnalyticsRows` + `EarningsTableSortKey`.
- `src/lib/meridian/meridian-earnings-analytics-core.test.ts` — 3 new regression tests.
- `src/features/meridian/components/MeridianEarningsAnalytics.tsx` — `MeridianEarningsTable` now calls the tested helper instead of an inline, untested comparator.
