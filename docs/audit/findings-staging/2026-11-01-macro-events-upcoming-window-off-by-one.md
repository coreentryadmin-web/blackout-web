> **kind:** FINDING

## `fetchUpcomingMacroEvents`/`fetchUpcomingMacroEventsLive` resolved their own window one calendar day short — FIXED

| | |
|---|---|
| **Area** | `src/lib/providers/macro-events.ts` (shared macro-calendar provider) |
| **Status** | FIXED |
| **Severity** | P2 — a silent, deterministic off-by-one in a shared read path consumed by Meridian's timeline, Night Hawk's market-wide macro rail, and Largo's macro tool |

### Root cause

Both `fetchUpcomingMacroEvents(daysAhead)` and `fetchUpcomingMacroEventsLive(daysAhead)` computed
the window's end date like this:

```ts
const today = todayEtYmd();                                  // e.g. "2026-06-15"
const todayParts = today.split("-").map(Number);
const endDate = new Date(
  Date.UTC(todayParts[0], todayParts[1] - 1, todayParts[2] + Math.max(1, daysAhead))
);
const end = todayEtYmd(endDate);                              // re-projects through America/New_York
```

`Date.UTC(...)` builds a **UTC-midnight** instant for the target calendar day. America/New_York is
**always behind UTC** (UTC-4 in summer, UTC-5 in winter) — there is no time of year where it is
ahead. So UTC midnight on day `D` is always 19:00 or 20:00 on day `D-1` in New York, and running
that instant back through `todayEtYmd` (an `Intl.DateTimeFormat` formatter scoped to
`America/New_York`) silently returns `D-1`, not `D`.

The comment directly above the code (*"Use calendar-day arithmetic in ET to avoid DST errors"*)
diagnosed a real hazard (a calendar day can be 23 or 25 hours across a DST transition) but picked
the wrong fix for it: this is **pure calendar-date arithmetic** — there is no real-world instant to
anchor at all, so routing it through a timezone formatter a second time was never correct, DST or
not. `Date.UTC`'s own Y/M/D rollover (month length, leap years) already does the calendar math
correctly; the bug is entirely in re-projecting the result through `America/New_York` afterward.

### Evidence

Isolated the exact computation and ran it standalone (Node 20):

```
$ node -e '
function todayEtYmd(d){ return new Intl.DateTimeFormat("en-CA", {timeZone:"America/New_York"}).format(d); }
const today = "2026-06-15";
const todayParts = today.split("-").map(Number);
const daysAhead = 7;
const endDate = new Date(Date.UTC(todayParts[0], todayParts[1]-1, todayParts[2]+Math.max(1,daysAhead)));
console.log("endDate UTC iso:", endDate.toISOString());
console.log("end (ET ymd):", todayEtYmd(endDate));
console.log("expected end:", "2026-06-22");
'
endDate UTC iso: 2026-06-22T00:00:00.000Z
end (ET ymd): 2026-06-21     <-- one day short
expected end: 2026-06-22
```

For ET "today" = 2026-06-15 and `daysAhead = 7`, `fetchUpcomingMacroEvents(7)` resolved its window
to `["2026-06-15", "2026-06-21"]` — six calendar days wide, not seven — and silently dropped any
curated macro event (CPI/NFP/FOMC) dated exactly `2026-06-22`. The bug fires on **every call,
every day of the year** (it is a direction-of-offset fact about `America/New_York` vs UTC, not a
DST-transition edge case), and was previously **completely untested** — `macro-events.test.ts` had
no test for either `fetchUpcomingMacroEvents` or `fetchUpcomingMacroEventsLive` before this fix.

### Blast radius

Both exported functions built the same broken `end` computation independently (copy-pasted, not
shared) — fixed both call sites at once by extracting one pure helper, `etYmdPlusDays`, rather than
patching the duplicated logic twice and leaving a second copy to drift.

Consumers of the two fixed functions (unchanged by this PR, but newly correct as of this fix):

- `src/lib/meridian/meridian-snapshot.ts` → `fetchUpcomingMacroEventsLive(daysAhead)` feeds
  Meridian's snapshot macro rail.
- `src/lib/largo/run-tool.ts` → `fetchUpcomingMacroEventsLive(daysAhead)` feeds the Largo chat
  tool's upcoming-macro answer.
- `src/features/meridian/lib/meridian-timeline.ts`, `src/features/nighthawk/lib/market-wide.ts`,
  and the several `src/features/spx/lib/*` consumers import from the same `macro-events.ts` module
  but go through other exports (`macroEventsOnDate(Live)`, `parseUwEconomicCalendar`) that were not
  affected by this specific bug — not touched by this fix.

Net effect of the bug in production: any desk surfacing "macro events in the next N days" was
quietly showing an N-1-day window and could miss a real CPI/NFP/FOMC print landing exactly on day N
— the kind of print these surfaces exist specifically to warn about.

### Fix rationale

Extracted the day-arithmetic into one pure, exported helper (`etYmdPlusDays(ymd, days)`) that never
touches a timezone formatter — it reads the UTC calendar fields straight back off the `Date.UTC(...)`
result (`toISOString().slice(0, 10)`) instead of re-projecting through `America/New_York`. Both
`fetchUpcomingMacroEvents` and `fetchUpcomingMacroEventsLive` now call this one helper instead of
each carrying its own (buggy, duplicated) inline computation.

Deliberately left unchanged: `todayEtYmd()` itself (correct — it formats a REAL instant, `now`,
through the ET zone, which is exactly what that operation is for) and every other date helper in
this file (`isoUtcToEtYmd`, `isoUtcToEtHhmm`) that converts a genuine UTC instant to its ET-local
reading — those are not calendar-arithmetic and are not affected by this bug class.

### Regression test

`src/lib/providers/macro-events.test.ts` — added:
- `etYmdPlusDays adds calendar days without rolling back a day through the ET timezone (regression)`
  — reproduces the exact `2026-06-15 + 7 → 2026-06-22` case from the evidence above (previously
  `2026-06-21`), plus a DST-boundary case and a month/year-rollover case.

RED→GREEN confirmed via `git stash` on `src/lib/providers/macro-events.ts` alone: with the fix
stashed out, the new test fails with `etYmdPlusDays is not a function` (the export does not exist
pre-fix); restored, all 6 tests in the file pass. `tsc --noEmit` clean.
