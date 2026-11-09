> **kind:** FINDING

## Meridian desk's "Next 24h" stat card counted "today OR tomorrow" (up to ~48h out), not the next 24 hours — FIXED

| **Status** | FIXED |
|---|---|
| **Severity** | P3 (member-visible, Meridian desk header stat — no trading decision reads this count directly) |
| **Area** | `src/lib/meridian/meridian-snapshot.ts` → moved to `src/features/meridian/lib/meridian-timeline.ts` |

### Root cause

`buildTimelineStats()` (previously a local, untestable function inside
`meridian-snapshot.ts`, which carries `import "server-only"`) computes the counters shown
on the Meridian desk's stat-card row. One of those counters is rendered on the live desk
as the **"Next 24h"** stat card (`MeridianDesk.tsx:344`, `<MeridianStatCard
value={stats.next_24h} label="Next 24h" ...>`) and is independently described platform-
wide, in `src/lib/x-intel/view-catalog.ts`, as `"Meridian prints in the next 24 hours"`
(`id: "meridian.next_24h"`) — i.e. two separate parts of the product both assert this
number means "within the next 24 hours."

It was computed as:

```ts
next_24h: items.filter((i) => i.days_until <= 1).length,
```

`days_until` comes from `daysUntilEt()` (`meridian-timeline.ts`), which is a **calendar-
day** distance in US/Eastern — it has NO time-of-day component:

```ts
export function daysUntilEt(eventYmd: string, todayYmd: string): number {
  const a = Date.UTC(y1, m1 - 1, d1); // today, midnight UTC-of-the-YMD
  const b = Date.UTC(y2, m2 - 1, d2); // event date, midnight UTC-of-the-YMD
  return Math.round((b - a) / 86_400_000);
}
```

So `days_until === 1` means "the event's ET calendar date is tomorrow" — nothing more. An
item dated tomorrow can be anywhere from a few minutes away (if it lands right after
midnight ET) to **just under 48 hours away** (if `now` is 00:05 ET today and the item's
ET date is tomorrow at 23:55). Counting `days_until <= 1` therefore counts "today's items
PLUS every one of tomorrow's items, regardless of what time tomorrow", which is routinely
close to double the real "within the next 24 hours" population — worst right after
midnight ET, when the entire next calendar day (a full 24h) still reads as "days_until
=== 1" and gets folded into a card that claims to be a 24-hour window.

This was never caught because `buildTimelineStats` lived inside a `server-only` module
with no sibling test file — it is the one Meridian-timeline stat-building function this
codebase's otherwise-thorough day-granularity audits (`meridian-reaction-core.ts`,
`meridian-timeline.ts`'s own `priorOpexDates`/`monthlyExpiryYmd` fixes, etc.) never
reached, because there was no way to unit-test it in place.

### Evidence (RED → GREEN)

Moved `buildTimelineStats` into `src/features/meridian/lib/meridian-timeline.ts` (a pure,
`server-only`-free module that already has a test file, same split precedent as
`vector-daily-regime-server.ts` / `vector-daily-regime.ts`), then added
`meridian-timeline.test.ts` cases.

RED (pre-fix, `days_until <= 1`), run against the new tests:

```
not ok - buildTimelineStats: next_24h counts ONLY today's items, not tomorrow's
  only the two days_until===0 items are genuinely within 24h
  3 !== 2
```

(4 stub items: two at `days_until: 0`, one at `days_until: 1`, one at `days_until: 7` —
the buggy version counted the `days_until: 1` item as "next 24h" too, reporting 3 instead
of the correct 2.)

GREEN (post-fix, `days_until === 0`): all 12 tests in `meridian-timeline.test.ts` pass,
including the two new regression cases (the fix case above, an empty-timeline all-zero
case, and a case confirming the other five counters — `macro`/`earnings`/`fda`/`opex`/
`high_impact`/`earnings_mega_cap` — are completely unaffected by this change).

Confirmed by reverting the one line via `sed` and re-running
`npx tsx --experimental-test-module-mocks --test
src/features/meridian/lib/meridian-timeline.test.ts` (RED above), then restoring the fix
and re-running the full `meridian-timeline.test.ts` + every `src/lib/meridian/*.test.ts`
file (548 tests, 0 failures) and `npx tsc --noEmit` (clean).

### Blast radius

Single call site: `buildTimelineStats` is called exactly once, from
`loadMeridianTimelineResponse()` in `meridian-snapshot.ts`, which is the shared builder
behind both the `/api/market/meridian/timeline` route and the `warmMeridianCaches` cron
pre-warm. No other function duplicates this `next_24h` counting logic (checked: no other
`days_until` comparison exists outside `meridian-timeline.ts` itself and the gate
functions in `upcomingOpexDates`/`priorOpexDates`, which are unrelated OpEx-date walks,
not stat counting).

### Fix rationale

`days_until === 0` ("today", by ET calendar date) is the closest honest reading of
"within the next 24 hours" available at this data model's day-level granularity, without
threading each item's actual release `time` (known for some kinds — earnings, macro — but
`null` for others, e.g. FDA decisions, which have no reliable intraday timestamp) through
a brand-new sub-day time-window computation. Every `days_until === 0` item is, by
construction, no more than one remaining calendar day away — narrowing from `<= 1` to
`=== 0` only REMOVES the clearly-wrong "tomorrow can be up to ~48h out and still count as
next-24h" cases; it never introduces a new overcount or undercount in the other
direction, and it changes nothing about the other five counters in the same function
(verified by the new "other counters are unaffected" test above).

Deliberately left unchanged: `daysUntilEt`'s own day-granularity (correct and shared by
many other, unrelated derivations — changing its semantics would be a much larger,
out-of-scope change), and every other field on `MeridianTimelineStats`.
