# 2026-11-09: SPX Slayer `desk_context.minutes_to_no_entry`/`minutes_to_force_exit` ticked down before the cash open — FIXED

> **kind:** `FINDING`

**Status.** FIXED — this PR.

## Summary

`GET /api/market/spx/play`'s `desk_context` sub-object carries three "time remaining today"
countdowns, computed by `buildSpxPlayDeskContext()` in `src/features/spx/lib/spx-play-context.ts`.
`minutes_to_close` correctly nulls pre-open (it has its own explicit
`if (etMins < CASH_OPEN_ET_MINS) return null;` guard), but the other two —
`minutes_to_no_entry` and `minutes_to_force_exit` — had no equivalent guard and happily rendered
live-looking countdowns on an ordinary trading-day **pre-market** read, even though the top-level
payload already reported the session as closed.

Confirmed live: `GET /api/market/spx/play` at `2026-11-09T10:48:49Z` (well before the 9:30am ET
cash open) returned `headline:"Session closed"`, `session_phase:"closed"`,
`gates.blocks:["Session closed"]`, yet:

```json
"desk_context": {
  "minutes_to_close": null,
  "minutes_to_no_entry": 579,
  "minutes_to_force_exit": 594,
  ...
}
```

— ticking down 1-for-1 with wall-clock time on a repeat poll a minute later (578/593). The
numbers match the raw formula exactly (`cutoff_mins − current_et_mins`), confirming root cause
precisely: this is live "minutes until" math running with no session behind it at all.

## Root cause

```ts
function minutesUntilNoEntry(now = new Date()): number | null {
  if (!isTradingDayEt(formatEtDate(now)) || isPastNoEntryCutoff(now)) return null;
  const etMins = etMinutes(now);
  const earlyClose = getEarlyCloseMinutes(now);
  const cutoffMins = earlyClose != null ? earlyClose - 30 : etClock(15, 30);
  if (etMins >= cutoffMins) return null;
  return cutoffMins - etMins;               // <-- no pre-open gate before this
}
```

(`minutesUntilForceExit` has the identical shape, cutoff ≈ 15:45 ET.) `isTradingDayEt` is a
weekday+holiday check and `isPastNoEntryCutoff`/`isPastForceExitCutoff`
(`spx-play-session-guards.ts`) are pure **afternoon**-cutoff checks (`etMinutes(now) >=
cutoffMins`, cutoff ≈ 15:30/15:45 ET) — neither has any morning-side gate. So on an ordinary
trading-day pre-market read (e.g. 6am ET), `isTradingDayEt` is `true` and `isPast*Cutoff` is
`false` (nowhere near the afternoon cutoff yet), and both functions fall straight through to the
live countdown arithmetic as if the session were already open.

This is the same bug **class** already fixed once before, for NYSE holidays (see FINDINGS.md's
"SPX Slayer desk_context countdowns ignored NYSE holidays" entry, PR #4554, commit
`c464a6856`) — that fix swapped `isEtWeekday` for `isTradingDayEt` in all three functions so a
holiday nulls every countdown. But that fix's own documented "Blast radius" section explicitly
left `isPastNoEntryCutoff`/`isPastForceExitCutoff` untouched, calling them "pure time-of-day
cutoffs" — correct as far as it goes, but it meant the **pre-open** gap (distinct from the
holiday gap that fix targeted) was never covered by that fix or any later one. Verified by
grepping `docs/audit/FINDINGS.md` and `docs/audit/findings-staging/` before writing this entry:
no existing entry covers this specific pre-open case.

## Fix

Added the identical pre-open guard `minutesToCashClose` already had, to both
`minutesUntilNoEntry` and `minutesUntilForceExit`, in the same place in the control flow (right
after computing `etMins`, before the cutoff-specific math):

```ts
if (etMins < CASH_OPEN_ET_MINS) return null;
```

`CASH_OPEN_ET_MINS` (`etClock(9, 30)`) was already imported into `spx-play-context.ts` and in
scope in this file — `minutesToCashClose` already uses it — so no new import was needed.

## Blast radius

`spx-play-context.ts` only — `minutesUntilNoEntry`/`minutesUntilForceExit`, consumed solely via
`buildSpxPlayDeskContext`/`enrichPlayPayload` → `GET /api/market/spx/play`.
`isPastNoEntryCutoff`/`isPastForceExitCutoff` in `spx-play-session-guards.ts` were deliberately
**not** touched, per the same scoping rationale the prior holiday fix already documented — they
are correctly pure afternoon-cutoff checks, used elsewhere (flat-path BUY/WATCH gating,
open-play HOLD/TRIM gating) where a pre-open gate would be wrong to add, since those call sites
already have their own pre-open handling upstream. The fix belongs entirely in this file's two
display-countdown functions, not in the shared session-guards module.

## Fix rationale

Mirrored `minutesToCashClose`'s own existing guard verbatim rather than inventing a new check —
one proven pattern for "no countdown before the session opens," reused across all three sibling
functions in the same file.

## Why this wasn't caught by the prior holiday fix

The prior fix's own regression test (`spx-play-context.test.ts`, "NYSE holiday on a weekday nulls
every countdown") exercises a **mid-RTH** wall-clock time (14:21 ET) on a holiday — exactly the
time window needed to prove the holiday gate works, but it never touches a pre-open wall-clock
time on an ordinary trading day, so it could not have caught this separate gap. This PR adds a
dedicated test for exactly that case.

## Evidence (RED → GREEN)

RED→GREEN via `git stash` on the source file only (test file kept), run on Node 20
(`/opt/nvm/versions/node/v20.20.2/bin`):

```
$ npx tsx --experimental-test-module-mocks --test src/features/spx/lib/spx-play-context.test.ts   # pre-fix (stashed)
not ok 6 - buildSpxPlayDeskContext: pre-open ET time on an ordinary trading day nulls the no-entry/force-exit countdowns too
  minutes_to_no_entry must null pre-open, same as minutes_to_close
  570 !== null
# tests 8
# pass 7
# fail 1

$ npx tsx --experimental-test-module-mocks --test src/features/spx/lib/spx-play-context.test.ts   # post-fix
# tests 8
# pass 8
# fail 0
```

The existing sibling control test ("ordinary trading day at the same ET time still counts down",
mid-RTH 14:21 ET) and the new companion control ("post-open, pre-cutoff ET time still returns
live no-entry/force-exit countdowns") both still pass post-fix — proving the fix is pre-open-
specific, not a blanket null.

Live evidence: `GET /api/market/spx/play` on production, `2026-11-09T10:48:49Z` (pre-market) and
a repeat poll a minute later, captured via a temp premium Clerk session —
`desk_context.minutes_to_no_entry` ticking 579 → 578 and `minutes_to_force_exit` ticking
594 → 593 alongside `gates.blocks: ["Session closed"]` in the same payload.

`npx tsc --noEmit` clean.
