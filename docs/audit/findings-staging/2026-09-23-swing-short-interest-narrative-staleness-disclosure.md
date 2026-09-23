## Short-interest narrative block had no staleness disclosure for a genuinely lagging read

> **kind:** `FINDING`

| Field | Value |
| --- | --- |
| **Status** | FIXED |
| **Area** | Night Hawk Swings — `src/lib/swing/play-brief-intel.ts`, `src/lib/swing/play-brief-absence.ts` |
| **Severity** | P3 (narrative-quality gap, not a live-trading bug) |
| **Found by** | Night Hawk Swings audit lane, Ask Largo standing mandate — re-verification of #4076 comment 5747893411's "secondary, smaller asymmetry" |

### Root cause

Comment 5747893411 on #4076 (raised 2026-09-20) flagged two related gaps in how `catalystsSection`
(`play-brief-intel.ts`) presents short-interest evidence:

1. **Primary**: the evidence array's freshness *tag* used the generic cross-product
   `freshnessFromAgeMs` bucket (`<60s live, <10min recent, else stale`), so every short-interest
   read — 2 hours old or 59 days old — got the identical `"stale"` tag, misleading given FINRA's
   biweekly settlement cadence.
2. **Secondary**: `catalystsSection`'s narrative *body* only ever called `fundamentalsAncient` (the
   omit-or-show gate) — it never disclosed staleness inline the way the headlines block a few lines
   below it already does (`staleLead`/"Last snapshot (~Xs old)").

The primary gap was fixed separately (`fundamentalsFreshnessTag()` with a 15-day
`FUNDAMENTALS_RECENT_CEILING_MS`, already on `main` — confirmed live this cycle, see the #4076
status-correction comment posted the same session). The secondary gap was still live: a
short-interest read that clears the 15-day "recent" ceiling but hasn't hit the 60-day "ancient"
omission ceiling (i.e., genuinely lagging, by this data type's own honest cadence) rendered in the
narrative body with **zero** freshness context — worse than mislabeling, since the reader now has
no signal at all that the figure may be a stale settlement cycle behind.

### Evidence

Re-read `catalystsSection` (`play-brief-intel.ts` ~973-979 pre-fix): the short-interest block built
its two bullet fragments (`short DTC`, `short vol ratio`) and pushed them straight into `lines`
with no freshness check, while the headlines block immediately below it (~989-993) already computes
`newsCatalystStale`/`ageSecondsLabel` and prepends a `staleLead` sentence when stale. Confirmed via
`grep` there was no equivalent call for the fundamentals block.

### Blast radius

One call site: `catalystsSection`'s short-interest bullet block. `shortInterestCoaching`
(`play-brief-narrative-coaching.ts`) reads the same `arsenal.fundamentals` field for a different
narrative surface and was not touched — out of scope for this finding, left as a follow-up if the
same gap is confirmed there too.

### Fix

- Added `fundamentalsAgeMs(asOf, readMs)` to `play-brief-absence.ts` (mirrors `newsCatalystAgeMs`'s
  shape, but via `fundamentalsObservedMs`'s ET-session-close-aware parser for date-only stamps).
- Added `ageDaysLabel(ageMs)` to `play-brief-absence.ts` (mirrors `ageSecondsLabel`'s exact
  null/clock-skew handling, day-scaled instead of second-scaled — a seconds label would read as
  absurd precision for days/weeks-cadence data).
- `catalystsSection`'s short-interest block now computes
  `fundamentalsFreshnessTag(f.as_of, readMs) === "stale"` and, only when true, prepends
  `**Last settlement**${ageLabel ? \` (~${ageLabel} old)\` : ""} — short-interest may lag the current cycle.` —
  the exact same `staleLead` shape the headlines block already uses, so a normal few-days-old read
  (inside the 15-day recent ceiling) still renders with zero disclosure, unchanged from before.

### Fix rationale

Mirrors an existing, already-shipped pattern in the same function (`newsCatalystStale`'s
`staleLead`) rather than inventing a new disclosure mechanism — small, mechanical, matches the
comment's own characterization ("a small, mechanical mirror of the existing headlines pattern
rather than a new design question"). Left `shortInterestCoaching` untouched since it wasn't part of
the original live repro and touching it would widen this PR past the one gap actually confirmed.

### Tests

Two new tests in `play-brief-intel.test.ts`: a ~25-day-old short-interest read (beyond the 15-day
recent ceiling, under the 60-day ancient ceiling) carries the disclosure; a ~3-day-old read carries
none. RED→GREEN proven via `git stash` isolation of the implementation files — 199/200 pass without
the fix (the new "lagging read discloses" test fails as expected), 200/200 with it.
