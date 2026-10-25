## 2026-10-25 — [FINDING, P3 Meridian] Timeline's "Next 24h" stat tile is a calendar-day proximity count, not an actual rolling 24-hour window — OPEN

> **kind:** `FINDING`

| Field | Detail |
|---|---|
| **Area** | Meridian timeline stats (`src/lib/meridian/meridian-snapshot.ts`, consumed by `src/features/meridian/components/MeridianDesk.tsx`) |
| **Found by** | DISCOVERY-lane standing audit mandate, fresh-angle sweep on 2026-10-25 (Meridian lib loaders behind the thin `event`/`lookup`/`peer-reactions`/`timeline` API routes) |

### Symptom

`MeridianDesk.tsx:366` renders a live "Next 24h" stat tile (`<MeridianStatCard value={stats.next_24h}
label="Next 24h" .../>`) that members read as "how many catalysts are coming up in the next day."
The underlying count does not measure a rolling 24-hour window from now — it measures calendar-date
proximity only, so it both over-counts (events that already happened earlier today) and under-counts
(events up to ~47 hours away) relative to what the label promises.

### Root cause

`buildTimelineStats` (`meridian-snapshot.ts:37`):
```ts
next_24h: items.filter((i) => i.days_until <= 1).length,
```
`days_until` comes from `daysUntilEt` (`src/features/meridian/lib/meridian-timeline.ts:35-42`), which
is a **pure calendar-day diff** between two YMD strings (`Date.UTC(y,m,d)` subtraction, divided by
86.4M ms) — it carries no time-of-day information at all:
```ts
export function daysUntilEt(eventYmd: string, todayYmd: string): number {
  const [y1, m1, d1] = todayYmd.split("-").map(Number) as [number, number, number];
  const [y2, m2, d2] = eventYmd.split("-").map(Number) as [number, number, number];
  const a = Date.UTC(y1, m1 - 1, d1);
  const b = Date.UTC(y2, m2 - 1, d2);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}
```
So `days_until <= 1` means "today or tomorrow by calendar date," not "within the next 24 hours from
the current instant." Concrete failure cases:
- An event that printed BMO (before market open) this morning is still counted in "Next 24h" at
  11:59pm the same day — up to ~16+ hours after it already happened.
- An event scheduled for tomorrow at 23:00 ET, checked just after midnight today, is genuinely
  ~47 hours away but still counted as "Next 24h" because both dates differ by only 1 calendar day.

No test covers this specifically — `grep -rn "next_24h" --include="*.test.ts"` returns zero hits.

### Why a drive-by fix isn't appropriate here

A correct fix needs each item's date+time resolved to a real ET instant and compared against "now"
within an actual rolling 24h window — but not every item carries a usable time: macro/opex items
and most earnings rows have a real `time` (`HH:MM`, e.g. `08:00`/`16:20`/`16:00`), while **FDA items
carry `time: null`** (`meridian-timeline.ts:252`). A fix therefore requires a design decision on the
FDA fallback (treat as end-of-day for the "next 24h" check? exclude FDA from the precise window and
keep day-based inclusion only for that kind? something else?) — this is a product/design call, not a
mechanical patch, so it is reported here for the Meridian lane owner to decide rather than built
unilaterally per the standing DISCOVERY-lane write-up policy for findings that aren't small and
self-contained.

### Blast radius

Single call site (`buildTimelineStats`'s `next_24h` field) feeding a single consumer
(`MeridianDesk.tsx`'s stat tile). `daysUntilEt` itself is also used elsewhere for genuinely
calendar-day-scoped purposes (upcoming-earnings date bucketing) where the current semantics are
correct — the bug is specific to using it as a proxy for a rolling-hour window, not a defect in
`daysUntilEt` itself.

### Status

OPEN — needs a Meridian-lane design decision on the FDA (`time: null`) fallback before a fix can be
written; no code changed by this finding.
