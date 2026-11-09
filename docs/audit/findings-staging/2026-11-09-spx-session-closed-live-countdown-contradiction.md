# 2026-11-09: SPX Slayer `/play` closed-market payload showed live, ticking-down session countdowns alongside "Session closed" (third occurrence of this bug class)

> **kind:** `FINDING`

**Status.** FIXED — this PR.

## Summary

`GET /api/market/spx/play`'s closed-market branch (`evaluateSpxPlayCore`,
`src/features/spx/lib/spx-play-engine.ts`, the `!desk.market_open && !premarket` branch) fires
whenever `desk.market_open` is falsy and emits `session_phase: "closed"`,
`headline: "Session closed"`, `thesis: "Desk offline · CLOSED · resumes 6:30 AM PT"`, and
`gates.blocks: ["Session closed"]` — a payload that tells the member the desk is down until the
next session.

The SAME payload's `desk_context` block (`buildSpxPlayDeskContext`,
`src/features/spx/lib/spx-play-context.ts`) computed `minutes_to_close`, `minutes_to_no_entry`,
and `minutes_to_force_exit` from **wall-clock ET time + `isTradingDayEt()` only** — with no
dependency on `desk.market_open` at all. On an ordinary weekday, mid-RTH, these three fields kept
returning live, non-null, ticking-down values regardless of whether the rest of the payload
claimed the session was closed.

Confirmed live via two real polls five minutes apart during confirmed RTH on an ordinary Monday
trading day (no NYSE holiday):

- `as_of: 2026-11-09T15:29:58.182Z` — `headline:"Session closed"`, `session_phase:"closed"`,
  `gates.blocks:["Session closed"]`, `thesis:"Desk offline · CLOSED · resumes 6:30 AM PT"`,
  alongside `desk_context:{"minutes_to_close":328,"minutes_to_no_entry":298,"minutes_to_force_exit":313}`.
- `as_of: 2026-11-09T15:35:50.791Z` — `desk_context:{"minutes_to_close":325,"minutes_to_no_entry":295,"minutes_to_force_exit":310}`
  — the numbers moved down between polls, proving they were a live, real countdown (328 minutes
  from ~10:30 AM ET correctly lands at ~4:00 PM ET close), not a frozen placeholder — on a payload
  simultaneously claiming the session won't resume until the next morning.

This is the SAME bug class `spx-play-context.test.ts` already documents fixing **twice** this same
day for two different triggers:

1. **NYSE holiday on a weekday** (fixed 2026-09-07) — `isEtWeekday` (weekday-only) was replaced
   with `isTradingDayEt` (weekday + not-a-holiday) in all three helpers.
2. **Pre-open read** (fixed 2026-11-09, earlier) — `minutesUntilNoEntry`/`minutesUntilForceExit`
   gained the same `etMins < CASH_OPEN_ET_MINS` pre-open guard `minutesToCashClose` already had.

Neither fix covers this **third** trigger, because both of the first two triggers are cases where
the **calendar/clock itself** says no session is running — `isTradingDayEt` + wall-clock gating was
always sufficient. This trigger is different: it is a genuine, ordinary mid-RTH trading day
(`isTradingDayEt` true, wall clock squarely inside the 9:30am–4pm ET window) where
`desk.market_open` is false anyway, because of a live upstream **data outage** — the already-
tracked Polygon/Massive real-time-snapshot entitlement loss documented in `CLAUDE.md`'s
"Environment realities" section (`/v3/snapshot` family still 403ing as of this writing). The
calendar/clock agree a session is open; the live desk disagrees. The closed-market branch
correctly keys off `desk.market_open` alone (no calendar/clock condition) and fires — but
`desk_context`'s three countdowns never consulted `desk.market_open`, so they kept computing a
live answer from the calendar/clock side of that disagreement.

## Root cause

`src/features/spx/lib/spx-play-context.ts`'s `minutesToCashClose`, `minutesUntilNoEntry`, and
`minutesUntilForceExit` each gated purely on `isTradingDayEt(formatEtDate(now))` plus
wall-clock-derived cutoffs (`etMins < CASH_OPEN_ET_MINS`, `isPastNoEntryCutoff`,
`isPastForceExitCutoff`). None of the three ever received or consulted `desk.market_open` — the
one piece of information `spx-play-engine.ts`'s closed-market branch itself keys its entire
response off of. Whenever the two signals disagreed (calendar/clock says "in session", live desk
says "not open"), `desk_context` sided with the calendar/clock and rendered a live countdown on a
payload whose headline/thesis/gates all sided with the live desk.

`enrichPlayPayload` (same file) calls `buildSpxPlayDeskContext` **unconditionally** for every
payload `evaluateSpxPlayCore` produces, including the closed-market branch's own return value
(`spx-play-engine.ts:1611`), so this is not a narrow edge case — every closed-market response
during a data outage carries the contradiction.

### Why the prior two fixes didn't catch this

Both prior fixes added gating conditions derived purely from the calendar (`isTradingDayEt`) and
wall clock (`etMins`/cutoff comparisons) — neither fix's own blast-radius notes mention
`desk.market_open` at all, because neither trigger needed it: a holiday or a pre-open read is
already correctly null-able from the calendar/clock alone. This trigger specifically requires
information the calendar/clock cannot provide — whether the live desk itself reports the market
open — which is exactly the piece those two fixes never had reason to touch.

## Evidence (RED → GREEN)

RED (pre-fix, via `git stash` isolating only the `spx-play-context.ts` source change, new
regression tests left in place) — Node 20, `npx tsx --experimental-test-module-mocks --test
src/features/spx/lib/spx-play-context.test.ts`:

```
not ok 8 - buildSpxPlayDeskContext: desk.market_open:false during ordinary mid-RTH wall-clock
           time nulls every countdown (live data outage, not a calendar closure)
  error: minutes_to_close must null when the desk reports market_open:false, even mid-RTH
    99 !== null
  expected: ~
  actual: 99
```

(9/10 pass, 1 fail — reproducing the exact live defect: a live countdown value computed while
`desk.market_open` is `false`.)

GREEN (post-fix, fix restored from the stash):

- `spx-play-context.test.ts`: 10/10 pass (both the new test and its companion control,
  `market_open:true` at the identical wall-clock moment, still returns live countdowns —
  proving the new guard is `market_open`-specific, not a blanket null).
- `spx-play-engine.test.ts` + `spx-play-payload.test.ts` + `spx-play-context.test.ts` +
  `spx-play-gates.test.ts` together: 69/69 pass.
- Full `src/features/spx/lib/*.test.ts` suite: **973/973 pass, 0 fail**.
- `npx tsc --noEmit`: clean, no errors.

All runs on Node 20 (`/opt/nvm/versions/node/v20.20.2/bin`) per `CLAUDE.md`'s environment note.

## Fix

Threaded `desk.market_open` into all three countdown helpers (`minutesToCashClose`,
`minutesUntilNoEntry`, `minutesUntilForceExit`) as an additional, independent gate — `if
(!marketOpen) return null;` — and updated `buildSpxPlayDeskContext`'s call sites to pass
`desk.market_open ?? false` (matching the engine's own `!desk.market_open` treatment of
`undefined` as "not open").

This was chosen over the alternative (changing `spx-play-engine.ts`'s closed-market branch to
distinguish a genuine calendar closure from a live data outage with a different headline/thesis)
because it:

- **Matches the established fix pattern exactly.** Both prior fixes for this bug class landed
  entirely inside `spx-play-context.ts`'s own gating functions, without ever touching the engine's
  messaging. This fix is the same shape: one more gate, same functions, same file.
- **Is minimal and purely additive.** Every existing null-producing path (holiday, pre-open,
  post-cutoff) is unchanged; the new guard only changes the one case none of the existing tests
  exercise (`market_open:false` at a wall-clock moment that otherwise reads as live). The two
  control tests (pre-existing "ordinary trading day"/"post-open, pre-cutoff" tests, and the new
  companion control added by this PR) all use `market_open:true` and are untouched.
- **Needs no new information plumbed through.** `desk` is already a parameter of
  `buildSpxPlayDeskContext` — `desk.market_open` was sitting right there, unused, the whole time.
- **Avoids overlapping with a separate, concurrently-fixed SPX bug.** A different agent is fixing
  the `/play` route's generic error-catch block (`route.ts`/`spx-play-payload.ts`, stale "Desk
  warming" defaults) in parallel. Changing the engine's closed-market messaging text was the
  larger, more invasive of the two candidate approaches and risked touching copy/behavior adjacent
  to that other in-flight work; gating `desk_context` alone stays entirely inside
  `spx-play-context.ts` and its own test file, with zero touch on `route.ts` or
  `spx-play-payload.ts`.

Deliberately left unchanged: the closed-market branch's headline/thesis/messaging itself (still
says "Desk offline · CLOSED · resumes 6:30 AM PT" regardless of whether the cause is a genuine
calendar closure or a live data outage) — the member-facing copy distinguishing those two causes is
a larger, separate decision than this fix's scope, and is exactly the kind of engine-messaging
change noted above as the path most likely to overlap with the other agent's in-flight `route.ts`/
`spx-play-payload.ts` work. Flagging this explicitly rather than making the change, per this task's
own scoping instruction.

## Blast radius

One function group (`minutesToCashClose`/`minutesUntilNoEntry`/`minutesUntilForceExit`), one call
site (`buildSpxPlayDeskContext`), one consumer (`enrichPlayPayload`, called unconditionally by
`evaluateSpxPlay` for every response shape). No other field in `SpxPlayDeskContext` depends on
these three helpers, and no other caller of `minutesToCashClose`/`minutesUntilNoEntry`/
`minutesUntilForceExit` exists outside this file (grep-confirmed) — the fix cannot regress a
different consumer. The one adjacent scenario deliberately re-checked: when the closed-market
branch's own `openAfterClose` safety net falls through to the live evaluation path to force-settle
a play still open after the cash close, `desk.market_open` can still be `false` there too — this
fix now also nulls `desk_context`'s countdowns on that path, which is correct (the market has
genuinely closed or lost live data in that scenario as well, so a live-looking countdown would be
equally misleading there).
