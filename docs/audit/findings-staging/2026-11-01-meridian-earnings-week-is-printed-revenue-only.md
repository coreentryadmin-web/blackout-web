> **kind:** FINDING

# Meridian earnings-week `is_printed` undercounts revenue-only prints

| | |
|---|---|
| **Area** | Meridian — mega-cap earnings-week grid (`src/lib/meridian/meridian-benzinga-earnings-core.ts`) |
| **Status** | Fixed |
| **Severity** | P3 — user-visible undercount, not a data-correctness-of-numbers bug |

## Root cause

`buildEarningsWeekRows` (the source for `MeridianDesk`'s mega-cap earnings-week strip) derived
each row's `is_printed` flag with:

```ts
is_printed: r.actual_eps != null,
```

This checks only the EPS actual. Benzinga's structured-earnings feed sometimes populates
`actual_revenue` for a report before (or without) `actual_eps` landing — the same asymmetry the
file's own `benzingaToCalendarRow` (two call sites above, in the same file) already accounts for
with the complete check:

```ts
is_printed: row.actual_eps != null || row.actual_revenue != null,
```

So the exact same file carries both the correct check and the incomplete one for the same
underlying concept ("has this print landed"), diverging only because `buildEarningsWeekRows` was
written against EPS alone. Any row whose revenue actual has posted but whose EPS actual has not
(yet, or ever, for that print) is misreported as "not yet printed."

## Evidence

`buildEarningsWeekRows`'s output feeds `buildEarningsWeekAnalytics` (`meridian-benzinga-
analytics.ts`), which computes:

```ts
printed_this_week: weekRows.filter((r) => r.is_printed).length,
```

and that number renders directly in `MeridianDesk.tsx`:

```ts
const printed = `${a.printed_this_week}/${a.names_count} printed`;
```

i.e. a member-visible headline like "3/8 printed" on the earnings-week grid. A revenue-only print
(actual_eps still null) is a real, landed print that this headline would silently exclude from
its numerator, understating how many names in the mega-cap window have actually reported.

Added a RED→GREEN regression test (`meridian-benzinga-earnings-core.test.ts`):
constructed three rows — EPS-only print, revenue-only print, and a true not-yet-printed row — and
asserted `is_printed` on all three. Pre-fix: the revenue-only row asserted `false` (RED, matching
the bug). Post-fix: `true` (GREEN). Confirmed with `git stash`/`git stash pop` around the
production file to get a clean before/after on the identical test.

## Blast radius

Single call site: `buildEarningsWeekRows` is the only producer of `MeridianEarningsWeekRow.
is_printed`, consumed only by `buildEarningsWeekAnalytics`'s `printed_this_week` count (both in
`src/lib/meridian/`) and rendered by `MeridianDesk.tsx`'s headline. No other reader of
`earnings_week` rows depends on `is_printed`. `benzingaToCalendarRow`,
`benzingaRowToTimelineInput`, and `benzingaRowsToPrintHistory` elsewhere in the same file already
use the complete `actual_eps != null || actual_revenue != null` check (or an equivalent), so this
was the one remaining incomplete instance, not a pattern replicated elsewhere in this file.

## Fix rationale

Match the existing, already-correct check used three times elsewhere in the same file:
`r.actual_eps != null || r.actual_revenue != null`. No behavior change for the common case (both
fields null, or both populated together); only the asymmetric revenue-only/EPS-only case changes,
from incorrectly `false` to correctly `true`. No alternative considered — this is the established
in-file convention for "has this print landed," so there's nothing to design, only to apply
consistently.
