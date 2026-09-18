## A cold SPX desk replica served THURSDAY's close as "today's" price for ~50 minutes after Friday's own 4pm ET close

> **kind:** FINDING

| | |
|---|---|
| **Status** | FIXED |
| **Severity** | P2 (produced three real `data-correctness` cron Discord alerts against a genuine, self-resolving cross-provider disagreement — every alert was a symptom of one stale number, not three independent problems) |
| **Area** | SPX desk — `src/features/spx/lib/spx-desk.ts` (`buildSpxDeskPulse`'s off-hours cold-replica branch); root cause in `src/lib/providers/spx-session.ts` (`priorDayFromDailyBars`) |
| **Found by** | Investigation of a production Discord alert burst (`[invariant/spot]`, `[cross-provider/spot]`, `[cross-provider/spx]`), 2026-09-12 |

### Root cause

`buildSpxDeskPulse()`'s off-hours branch, when the in-process `lastPulseForSignals` cache is
empty (a cold replica — ECS restarts/re-inits the web tier every 1-3 minutes in normal operation,
so some replica is essentially always cold), falls back to serving `priorDayForPulseLane()`/
`fetchPriorDayCached()`'s `pdc` ("prior day close") AS the current off-hours `price` (PR #4037,
2026-09-05 — correctly fixed a worse `price: 0` bug, but didn't distinguish two different
off-hours states).

Both of those functions bottom out in `priorDayFromDailyBars(bars, todayYmd)`, which walks
Polygon daily bars backward and returns the last bar dated **strictly before** `todayYmd`. That is
correct pre-market/during RTH (today's own bar either doesn't exist yet, or is an in-progress
partial that must be skipped). It is **wrong** once today's own regular session has actually
ended: Polygon's daily-bars endpoint by then already carries today's own settled, complete bar,
but `todayYmd` (an ET calendar date) hasn't rolled over yet — still "today" until midnight ET —
so the function skips it anyway and returns YESTERDAY's close as "the most recent completed
session." A cold replica hitting this path between the close and midnight ET therefore serves a
close that is one full session stale as the live off-hours price.

### Live evidence (2026-09-12 investigation, reproduced here)

Confirmed against the exact numbers from the alert burst (all times below are ET):
- Thu 2026-09-10 SPX close: **7591.7**
- Fri 2026-09-11 SPX intraday low/high: **7636.75 / 7677.02**, close: **7656.98**

The desk served `price: 7591.7` (Thursday's close, mislabeled as live) while its own
`[invariant/spot]` check compared it against Friday's real day range (7636.75–7677.02) and the
`[cross-provider/spot]`/`[cross-provider/spx]` checks compared it against two independent fresh
Polygon `I:SPX` reads that correctly reported Friday's real close (7656.98) — three alerts, one
stale number, read three different ways. It self-resolved with no code change once the ET calendar
date rolled to Saturday (a fresh cold replica after that point correctly excludes Friday from "in
progress" since todayYmd is now Saturday, exclusive of both Thu and Fri) — which is why the
original investigation could confirm it was NOT currently live at the time of the alert re-check,
even though the root cause is still live and will recur every trading day between close and
midnight ET.

### Fix

`priorDayFromDailyBars(bars, todayYmd, anchorSessionComplete = false)` gains a third,
default-`false` parameter. When `true`, a bar dated exactly `todayYmd` is eligible (not skipped)
— i.e. "today's own session is done, treat its bar as the most recent completed session." Default
stays `false` so every existing call site (RTH price/pivot lookups, the Vector prior-day chart
anchor, the "displayed-session anchor" behavior) is byte-for-byte unchanged; only a caller that
explicitly knows its own session has ended opts in.

`spx-desk.ts` gains one new function, `fetchTodaysOwnCloseIfSessionComplete()`, a fresh Polygon
daily-bars read that calls `priorDayFromDailyBars(bars, today, true)`. The cold-replica branch of
`buildSpxDeskPulse()` now calls it — and prefers its result over the exclusive-of-today `prior` —
specifically when `market_label === "EXTENDED"` (the existing `marketStatusLabel()` helper's
signal for "past today's regular close, still the same ET calendar day, before midnight").

### Fix rationale / what was deliberately left unchanged

- **Did not change `priorDayFromDailyBars`'s default behavior.** The shared `cachedPriorDay`/
  `fetchPriorDayCached()` cache backs RTH-only `prior_close`/gap%/pivot consumers (e.g. the
  `buildSpxDeskPulseMinimal` price chain, and a `priorDayForPulseLane()` call inside the RTH
  branch of `buildSpxDeskPulse` itself) that all correctly want the ordinary, exclusive-of-today
  "prior day." Making the default inclusive-of-today would have silently changed pivot/gap-%
  math for every one of those call sites without any evidence they need it.
- **Did not fold the new lookup into the existing 60s `cachedPriorDay` cache.** That cache is
  shared across RTH and off-hours callers; writing an inclusive-of-today value into it would leak
  the wrong (inclusive) semantics into RTH callers reading the same cache moments later. The new
  helper deliberately does a fresh, uncached read instead — the existing code at this exact call
  site already documents that "off-hours has no fast-lane latency budget to protect," so one more
  Polygon read here carries no user-facing cost.
- **Used the existing `marketStatusLabel()` "EXTENDED" signal** rather than inventing a new
  close-time check, since it already distinguishes "past today's close, pre-midnight" from
  "before today's open" (PRE-MARKET) and weekend/holiday (CLOSED) using the same PT-based RTH
  window the rest of this module already relies on.
- **Known residual gap, not fixed here:** `marketStatusLabel()`'s "EXTENDED" threshold is a fixed
  1pm PT / 4pm ET close and does not know about early-close days (e.g. the day before
  Thanksgiving, actual close ~1pm ET). On such a day, between the early close and the normal 4pm
  ET threshold, a cold replica could still serve a stale close for a shorter window than the
  reproduced bug. This is a pre-existing imprecision in `marketStatusLabel()` itself (used
  elsewhere in this file already), not introduced by this fix, and is out of scope here — no
  early-close-day incident has been observed or reported; fixing it would require session-calendar
  awareness this module doesn't otherwise have.

### Evidence / tests

Added to `src/lib/providers/spx-session.test.ts`: a test reproducing the exact live numbers above
— `priorDayFromDailyBars(bars, "2026-09-11")` (default) still correctly returns Thursday's bar
(existing, intentional pre-close behavior, unchanged); `priorDayFromDailyBars(bars, "2026-09-11",
true)` returns Friday's own bar instead.

Added to `src/features/spx/lib/spx-desk-offhours-spot.test.ts` (this file's existing convention —
source-pattern assertions on the real module, matching its sibling tests in the same file): one
test confirming the cold-replica branch overrides `prior` with `fetchTodaysOwnCloseIfSessionComplete()`
specifically when `label === "EXTENDED"`, and one confirming that helper calls
`priorDayFromDailyBars` with `anchorSessionComplete: true`.

RED (`git stash` on both source files) → 3 new assertions fail, all 20 pre-existing tests in both
files still pass. GREEN after restoring the fix → all 23 pass. `tsc --noEmit` clean. Full
`npm test` on Node 20: see PR for the run result.
