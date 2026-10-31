> **kind:** FINDING

## Vector daily chart's OPEX marker uses the raw third Friday, silently vanishing on the two months it lands on a market holiday — FIXED

| | |
|---|---|
| **Area** | Vector desk — `VectorDailyChart` OPEX markers + the Largo `opexContext` tool that reads the same dates |
| **Status** | FIXED |
| **Severity** | P3 (data-correctness / silent UI omission — no financial loss, but a wrong/missing structural marker and a wrong "days to OpEx" answer) |

### Root cause

`src/features/vector/lib/vector-opex.ts`'s `thirdFriday(year, month)` computes the **raw calendar**
third Friday of a month and `opexDatesInRange()` marked that exact date on the Vector daily chart
with no holiday awareness at all.

Standard monthly options expire on the third Friday, but when that Friday is a market holiday the
listed expiration — and the last session with an actual daily bar for that week — moves to the
**preceding trading day**. Swept 2024-2028 (same sweep `meridian-timeline.ts`'s `monthlyExpiryYmd`
already ran for this exact bug class), exactly two third Fridays are not trading days:
**2026-06-19** and **2027-06-18**, both Juneteenth.

`VectorDailyChart.tsx` renders OPEX marks via lightweight-charts' `createSeriesMarkers`, passing a
`time` for each mark that must match an existing series point. Juneteenth is a full NYSE closure —
Polygon's daily bars skip the date entirely — so a marker timestamped `2026-06-19` has **no candle
to attach to**, and the library silently drops it. The visible symptom: the Vector chart's OPEX
marker vanishes for June in years when the third Friday falls on Juneteenth, with no error, no
empty-state, nothing — the same "silent hole" shape as the `meridian-timeline.ts` defect this
mirrors (that one was found 2026-08-21: a permanently-null prior-OpEx history row for the identical
reason, raw third Friday with no holiday rollback).

### Evidence

Before the fix, on origin/main (`745f7b7f`):
```
thirdFriday(2026, 6)  === "2026-06-19"   // the raw third Friday
isTradingDayEt("2026-06-19") === false   // Juneteenth — market closed, no bar exists
opexDatesInRange(Date.parse("2026-06-01T00:00:00Z"), Date.parse("2026-06-30T00:00:00Z"))
  === ["2026-06-19"]                     // marks a date with no candle under it
```
RED→GREEN proven via `git stash` on `vector-opex.ts` alone (test file kept): the two new tests
(`monthlyExpiryYmd rolls the raw third Friday back off a market holiday`,
`opexDatesInRange marks the holiday-rolled date, not the un-tradable raw Friday`) failed against
the stashed (pre-fix) source — one with `monthlyExpiryYmd is not a function`, one with
`opexDatesInRange` returning `["2026-06-19"]` instead of `["2026-06-18"]` — and passed once the
source was restored. Full suite run: `vector-opex.test.ts` (8/8), `session.test.ts`,
`vector-analytics-core.test.ts`, `vector-analytics-wiring.test.ts`, and the sibling
`meridian-opex-holiday.test.ts` all green (58+6+8 tests, 0 failures).

### Blast radius

- `src/features/vector/components/VectorDailyChart.tsx` — the chart's OPEX vertical markers
  (`opexDatesInRange` → `createSeriesMarkers`). This is the directly user-visible defect: a missing
  OPEX mark on a dealer-positioning chart whose entire premise is explaining price action around
  structural gamma events.
- `src/lib/largo/vector-analytics-core.ts`'s `opexContext()` (a Largo tool answer) imports
  `opexDatesInRange`/`isQuarterlyOpex` from this same file and explicitly defers "which Friday is
  OpEx" to it (its own comment: *"which Fridays are OpEx remains entirely the production
  function's call"*) — so before this fix, asking Largo "how many days until OpEx" in mid-June
  2026 would have answered off the un-tradable `2026-06-19` instead of the real `2026-06-18`,
  a 1-day error in the "days away" field. **Not touched directly** — `src/lib/largo/` is an owned
  lane excluded from this sweep; the fix at the shared root (`vector-opex.ts`, not excluded)
  automatically carries through to it with no edit to the excluded file, same as the pattern noted
  in the file's own code comment.
- `src/features/thermal/components/GexHeatmap.tsx` and `src/lib/providers/polygon-options-gex.ts`
  each carry their **own separate** `thirdFridayYmd`/mirror implementation (not importing from
  `vector-opex.ts`) and were checked: both are deliberately un-rolled-back by design, because they
  match against the live option chain's own expiry string, which stays keyed to the raw calendar
  third Friday even when settlement shifts (see `polygon-options-gex.ts`'s own comment, "the listed
  contract is still keyed to this date on the chain"). That is a different, correct use case
  (matching a key) and was left untouched.

### Fix rationale

Added `monthlyExpiryYmd(year, month)` — the holiday-rollback wrapper, mirroring
`meridian-timeline.ts`'s function of the same name and the same `isTradingDayEt` shared source of
truth (not a second, private holiday list) — and pointed `opexDatesInRange()` at it instead of the
raw `thirdFriday()`. `thirdFriday()` itself is left unchanged and still exported: it is pure
calendar math with its own passing tests or further reasonable consumers elsewhere, and the fix
only needed to change which date gets handed to the chart as "the" OPEX date for the month, not the
calendar primitive itself. `isQuarterlyOpex()` was left untouched — it only reads the month digits
of whatever date string it's given, so it works identically whether that date got holiday-rolled
or not (confirmed by the existing `isQuarterlyOpex("2026-06-19") === true` test, still passing,
plus the fact that a rollback never crosses a month boundary in any of the swept 2024-2028 cases).
