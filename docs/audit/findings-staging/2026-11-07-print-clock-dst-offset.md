> **kind:** FINDING

## Meridian print clock (`buildPrintClock`) miscounted `minutesUntil` by a full hour during EST — FIXED

**Status:** FIXED (round 364, DISCOVERY lane)

### Root cause

`buildPrintClock` (`src/lib/meridian/meridian-earnings-analytics-core.ts`) converts a Benzinga
ET wall-clock print time (`"16:30:00"`) into an absolute instant with a **hardcoded `-04:00`**
UTC offset:

```ts
const stamp = r.time ? Date.parse(`${r.date}T${r.time}-04:00`) : NaN;
```

`-04:00` is only correct for the ~8 months of the year ET observes EDT (daylight time). For the
other ~4 months — roughly early November through mid-March, i.e. right now (today is
2026-11-07) — ET is EST (`-05:00`), and every print time this function reads is parsed one full
hour off from the real instant.

This repo had already diagnosed and fixed the exact same bug shape once before, in
`meridian-viz-core.ts`'s `etWallClockToIso`, whose own doc comment reads almost like a warning
label for this file: *"a hardcoded `-05:00` is wrong for ~8 months of the year and a hardcoded
`-04:00` for the other ~4 — either way the countdown is an hour off across half the calendar."*
`buildPrintClock` was written (or never updated) to use the naive, wrong form that comment
describes, rather than the DST-aware converter that already exists in the same lib directory to
solve exactly this.

### Evidence

Reproduced live against the real `buildPrintClock` function. `2026-12-15T16:30:00` ET under EST
is `2026-12-15T21:30:00Z`. Ten real minutes before that instant:

```
minutesUntil computed: -50 (expected ~10)
```

Not just off by 60 — the **sign flips**: a print that is genuinely 10 minutes in the future reads
as having happened 50 minutes in the past. Added as a permanent regression test
(`meridian-earnings-analytics-core.test.ts`, "buildPrintClock: uses the real ET→UTC offset in EST
months, not a hardcoded EDT -04:00"):

- **RED** (before fix, `git stash` on just the source file): `-50 !== 10`, assertion fails.
- **GREEN** (after fix): `minutesUntil === 10`.

The two pre-existing `buildPrintClock` tests only ever used an August date (`2026-08-20`, EDT
season), so this defect shipped and stayed invisible to CI since EDT math was always correct —
the bug only manifests roughly Nov→Mar, and nobody had tested a winter date.

### Blast radius

`buildPrintClock` has exactly one production consumer, `MeridianPrintClock`
(`src/features/meridian/components/MeridianEarningsAnalytics.tsx`), which:

1. Highlights a row as **"imminent"** when `0 <= minutesUntil <= 120` — during EST this window is
   shifted a full hour, so a print due in e.g. 90 real minutes (and correctly imminent) can
   compute as `150` and miss the highlight, while one actually 150 minutes out can compute as
   `90` and wrongly flash imminent.
2. Renders the countdown text via `fmtCountdown(c.minutesUntil)` — directly visible to members as
   e.g. `"in 1h 50m"` vs the real `"in 50m"`, or in the sign-flip case, `"X ago"` for a print that
   has not happened yet.
3. Filters rows out of the clock entirely via `minutesUntil < -60 || minutesUntil > horizonHours * 60`
   — a print near either boundary can be wrongly included or wrongly dropped from the 24h clock
   during EST, since the filter itself runs on the miscomputed value.

No other call site reads `buildPrintClock`, and no other function in this file duplicates the
offset logic — `classifyPrintSession` only parses the wall-clock hour/minute (no UTC conversion,
unaffected), and every other date-math helper in this file (`buildCalendarGrid`, `buildWeekPulse`,
`buildBeatMissStreak`) compares ET calendar dates as strings, never crosses into UTC, and is
likewise unaffected.

### Fix rationale

Replaced the hardcoded `-04:00` parse with the shared `etWallClockToIso(r.date, r.time)` helper
already in `meridian-viz-core.ts`, which resolves the real ET→UTC offset for any given date via
`Intl.DateTimeFormat` (two-pass convergence across a DST boundary) rather than assuming one fixed
offset year-round. This was the deliberate choice over patching in a second ad-hoc DST table:
`etWallClockToIso` is already the shared, tested answer to this exact problem in this exact file
family, and reusing it means every Meridian surface stays on one real ET↔UTC conversion instead of
each accumulating its own slightly-wrong one. Nothing else in `buildPrintClock` changed — the
`-60`/`horizonHours*60` window logic, the unknown-time handling, and the sort order are untouched
and still covered by the two pre-existing tests (both still pass).
