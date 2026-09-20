## Swing `parseEarningsWindows` used the raw UTC calendar date instead of the ET trading day — FIXED

> **kind:** `FINDING`

| | |
|---|---|
| **Area** | Swing discovery ingest — `parseEarningsWindows` (`src/lib/swing/swing-catalyst.ts`) |
| **Severity** | P2 (silent, live, evening-hours data-correctness bug in the CATALYST pillar + EVENT_DRIVEN archetype classification) |
| **Status** | FIXED |

### Root cause

`parseEarningsWindows` derived its own idea of "today" via:

```ts
const todayYmd = new Date(asOfMs).toISOString().slice(0, 10);
```

— the UTC calendar date of the instant, not the ET trading-day date the earnings feed's own
`earnings_date`/`report_date` strings are stamped in. `swing-ingest.ts`'s caller passes `asOfMs =
Date.parse(args.asOf)`, the real scan/ingest instant — and this codebase's own live repros
elsewhere (e.g. `play-brief-narrative-coaching.ts`'s `printAlreadyLandedThresholdMs` fix, live
repro "2026-09-14 20:36 ET") confirm this pipeline genuinely runs well into evening ET hours, not
just during RTH.

Past ~20:00 ET (EDT) / ~19:00 ET (EST), the UTC calendar date is already the *next* day. So
`todayYmd` silently ran one day ahead of the real ET trading day during those hours, shifting every
`daysBetweenYmd(todayYmd, date)` comparison in the function by one: a same-day (ET) earnings print
could misclassify as `lastEarnings` (already happened, `daysAgo=1`) instead of `nextEarnings`
(`daysUntil=0`) — corrupting the CATALYST pillar's `earningsInWindow` hazard and the EVENT_DRIVEN
archetype's `catalystInWindow01` fit for any name evaluated during evening ET hours on its own
earnings day.

### Evidence

Confirmed `todayEt()` (`@/lib/et-date`) is this codebase's established single source of truth for
the ET session-calendar date — already used by `spx-session.ts` and every other ET-anchored
comparison in the repo — and that it already accepts an injectable `Date` for exactly this
non-"now" case (`export function todayEt(now: Date = new Date())`). `parseEarningsWindows` never
used it.

Concrete repro: `2026-07-24T23:30:00-04:00` (11:30pm EDT) is `2026-07-25T03:30:00.000Z`. The real
ET trading day is still `2026-07-24`, but the pre-fix `.toISOString().slice(0,10)` logic read
`"2026-07-25"` — one day ahead. An earnings row dated `earnings_date: "2026-07-24"` (today, ET)
computed `daysBetweenYmd("2026-07-25", "2026-07-24") = -1`, landing it in the `lastEarnings`
(past) branch with `daysAgo: 1`, instead of the correct `nextEarnings.daysUntil: 0`.

### Blast radius

Single function, one call site (`swing-ingest.ts`'s `assembleSwingDossierInput` catalyst block —
repo-wide grep confirms `parseEarningsWindows` has no other caller). Downstream consumers of its
output (`deriveCatalystReads`'s `earningsInWindow`/`catalystInWindow01`, the CATALYST pillar score,
EVENT_DRIVEN archetype classification, and ultimately any play-brief prose citing "earnings in
window") all inherit the corrected date, no further changes needed.

### Fix rationale

Swapped `new Date(asOfMs).toISOString().slice(0, 10)` for `todayEt(new Date(asOfMs))` — reusing the
existing, already-tested "single source of truth" helper rather than re-deriving a second ET-date
conversion. Purely a `todayYmd` derivation change; the rest of the function (the future/past split,
soonest/most-recent selection, surprise-pct parsing) is untouched.

### Tests

One new test in `swing-catalyst.test.ts`: an 11:30pm-EDT `asOfMs` with a today-ET-dated earnings row
must resolve `nextEarnings.daysUntil === 0` and `lastEarnings === null` (not the reverse). RED→GREEN
proven via `git stash` isolating the source fix from the test: reverting only `swing-catalyst.ts`
reproduces exactly 1 failure (the new test); restoring the fix returns to 13/13 pass in that file.
`swing-ingest.test.ts` (the one caller): 15/15 pass, no regressions. `npx tsc --noEmit`: clean. Full
`npm test` (Node 20): 14897 pass / 0 fail / 3 skipped (pre-existing, unrelated).
