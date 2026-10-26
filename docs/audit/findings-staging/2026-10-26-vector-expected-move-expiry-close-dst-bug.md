> **kind:** `FINDING`

## Vector expected-move cone hardcoded EDT's 16:00 ET close as 20:00 UTC — marked today's live 0DTE expiry "settled" an hour early under EST — FIXED

| **Status** | Fixed |
|---|---|

### Area

Vector desk — expected-move engine (`src/features/vector/lib/vector-expected-move-atm.ts`),
consumed by the expected-move cone shown on `/vector` and by swing/Largo callers that read
Vector's expected-move inputs.

### Root cause

`remainingYearsToExpiry` and `isExpirySettled` both computed the 4:00 PM ET market close via
a hardcoded `Date.parse(\`${expiry}T20:00:00Z\`)`. 20:00 UTC is 4:00 PM ET only under EDT
(UTC-4). Under EST (UTC-5, in effect from 2026-11-01), 4:00 PM ET is 21:00 UTC — so the old
constant read as 3:00 PM ET, an hour before the real close.

Found while auditing the codebase for the same bug class as the just-fixed
`src/lib/discord-eod-recap.ts` DST bug (hardcoded `T13:30:00Z` for 9:30 AM ET, same root
cause). Grepped for other hardcoded ET/UTC-offset time literals in non-owned code;
`polygon-options-gex.ts`/`gex-depth.ts`'s own `yearsToExpiry` use a fixed `-04:00` offset for
BOTH the expiry close and the "now" anchor, so the DST error cancels in the subtraction — not
a bug. This file's `remainingYearsToExpiry`/`isExpirySettled` compare a hardcoded-offset expiry
close against a REAL wall-clock `nowMs` (threaded from `Date.now()` in production), so the
error does NOT cancel.

### Impact

During the last hour of the regular trading session under EST (3:00–4:00 PM ET), the engine
would mark today's own still-live 0DTE expiry as "settled" and roll `nearestLiveExpiry` forward
to the next weekly/monthly contract — quoting the wrong front expiry's IV and a materially
different expected-move band during real, actionable trading hours, exactly the failure mode
the file's own `nearestLiveExpiry` doc comment already describes for the *evening-after-close*
case (the 2026-10-07 INTC bug, PR #5644) — this is the same bug shape triggered an hour early by
the EDT→EST flip instead of by hours-after-close. Dormant all EDT season; would have started
firing for real within days (DST ends 2026-11-01).

### Fix

Added `etUtcOffsetHours(dateYmd)` (reads America/New_York's actual UTC offset at noon UTC on
that calendar date via `Intl.DateTimeFormat`'s `shortOffset`, mirroring the identical helper
just added to `discord-eod-recap.ts` for the sibling bug) and a `marketCloseMs(expiry)` that
derives the correct UTC hour for the 4:00 PM ET close from that offset, replacing the hardcoded
`"T20:00:00Z"` in both `remainingYearsToExpiry` and `isExpirySettled`.

### Blast radius

Both functions are module-local (not exported) with two call sites, both in this same file
(`deriveExpectedMoveInputs`, `deriveExpectedMoveInputsForEarningsDate`). Confirmed via `grep -rn`
that `src/lib/providers/expiry-liveness.ts`'s own, unrelated `isExpirySettled` already derives
the ET hour correctly via `Intl.DateTimeFormat` with the real timezone (no hardcoded offset) —
not affected by this bug class, not touched. `vector-gex-reconstruct.ts`'s sibling
`yearsToExpiry` (anchored at session OPEN, for GEX gamma stability) also uses a fixed
`T13:30:00Z`/`T20:00:00Z` pair, but both ends are equally wrong together under EST and the
function only ever takes their *difference*, so the error cancels — a genuine near-miss, not a
live bug, left as-is per the DISCOVERY lane's own scope discipline (no observable effect to
fix).

### Evidence the fix works

RED→GREEN via `git stash` on the lib-only change: new regression test
(`src/features/vector/lib/vector-expected-move-atm.test.ts`, EST session date `2026-11-16`,
`nowMs` = 3:30 PM ET under EST) fails pre-fix (rolls forward to the wrong expiry/IV) and passes
post-fix (correctly quotes today's own still-live 0DTE). `npx tsc --noEmit` clean. Full suite
run alongside this change.
