> **kind:** FINDING

## Ask Largo swing play-brief — short-interest evidence unconditionally tagged "stale" — FIXED

| | |
|---|---|
| **Status** | FIXED |
| **Severity** | P3 (labeling/trust, not a wrong number) |
| **Area** | `src/lib/swing/play-brief.ts`, `src/lib/swing/play-brief-absence.ts` (Ask Largo swing play-brief) |
| **Found** | 2026-09-20, Ask Largo standing mandate (PR #4076 comment 5747893411) |

### Root cause

`catalystsSection`'s evidence array (`play-brief.ts`) tags every "Short interest: DTC Xd · short
vol ratio Y%" citation's `provenance.freshness` via `fundamentalsFreshness()`, which delegated to
the generic cross-product `freshnessFromObservedMs` (`answer-envelope.ts`): `<60s → live`,
`<10min → recent`, else `stale`. That bucketing is correct for market-tick-cadence data (GEX,
Vector, quotes) but wrong for short interest, which FINRA settles roughly twice a month — no
short-interest read can ever land inside a 10-minute window, so **every single short-interest
citation was tagged "stale"**, regardless of whether it was 2 hours old or 59 days old (the
honest ceiling `FUNDAMENTALS_ANCIENT_CEILING_MS` already omits past). A member reading the
Evidence list saw the same "STALE" tag used for a genuinely lagging GEX matrix or a 15-minute-old
Vector snapshot on a short-interest number that was, for that data type, completely current.

Live-verified before this comment was written: CRWD's play-brief this cycle had
`arsenal.fundamentals.as_of` ~2 days old (correctly not omitted — well inside the 60-day ancient
ceiling) but the evidence array's parallel entry read `freshness: "stale"`.

### Fix

Added a cadence-scaled freshness bucket specific to fundamentals (`fundamentalsFreshnessTag` in
`play-brief-absence.ts`, exported alongside the existing `FUNDAMENTALS_ANCIENT_CEILING_MS` and its
own `fundamentalsAncient()` guard, which already lives there for the identical
`catalystsSection`/`shortInterestCoaching` shared-field reason): within one FINRA settlement cycle
(15 days, `FUNDAMENTALS_RECENT_CEILING_MS`) reads as `recent`; beyond that (but still under the
60-day ancient ceiling, which already omits past it) reads `stale`, an honest signal the read may
be lagging the current settlement. Never `live` — there is no sub-cycle cadence for this data type
to claim. `play-brief.ts`'s `fundamentalsFreshness()` now delegates to this instead of the generic
bucket.

### Evidence

- RED→GREEN: new test "short interest evidence freshness is recent (not stale) for a few-days-old
  read..." in `play-brief.test.ts` — confirmed failing (`stale` actual vs `recent` expected)
  against the pre-fix source via `git stash`, passing after.
- Full `play-brief.test.ts` + `play-brief-absence.test.ts`: 173/173 pass, including the three
  pre-existing short-interest freshness tests (5-min-old → `recent`, 35-day-old → `stale`, 45-day
  under-ceiling → `stale`) unchanged — the new 15-day recent threshold doesn't move any of those
  three cases' existing expected verdicts.
- `tsc --noEmit` clean.

### Blast radius

Only `fundamentalsFreshness()`'s one call site (the evidence array in `catalystsSection`,
`play-brief.ts`) reads the new tag today. `shortInterestCoaching` (narrative coaching) doesn't
currently attach a freshness label at all — a separate, smaller gap noted in the originating PR
comment (no staleness disclosure mechanism there yet, unlike the headlines block's inline
"Last snapshot (~Xs old)" pattern) — left open, not fixed here, since it's an additive narrative
feature rather than a mislabeling correctness bug.

### Why this fix, not the alternative

The originating comment named two options: (a) a fundamentals-appropriate freshness bucketing, or
(b) drop the misleading `freshness` tag entirely in favor of bare age with no live/recent/stale
characterization. Went with (a) — it keeps the existing `BieFreshness` UI affordance (chips, tag
styling) working and gives a real, still-informative signal ("this is lagging its settlement
cycle") rather than removing information. Deliberately did not touch the shared cross-product
`freshnessFromAgeMs`/`freshnessFromObservedMs` primitive itself — widening `BieFreshness`'s
generic bucket thresholds would be a cross-product design call (GEX/Vector/quotes all share it),
exactly the caution the originating comment itself named.
