# SPX Slayer desk_context countdowns ignored NYSE holidays — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **ID** | BO-P2-spx-play-desk-context-holiday-gate |
| **Priority** | P2 |
| **Area** | SPX Slayer / `GET /api/market/spx/play` |
| **Status** | FIXED |

## Symptom

Live 5-engine monitor cycle, 2026-09-07 (Labor Day, NYSE holiday, market closed).
`GET /api/market/spx/play` correctly reported the top-level session as closed
(`headline: "Session closed"`, `gates.blocks: ["Session closed"]`, `session_phase: "closed"`),
but the response's `desk_context` sub-object rendered live-looking countdowns anyway:

```json
"desk_context": {
  "minutes_to_close": 97,
  "minutes_to_no_entry": 67,
  "minutes_to_force_exit": 82,
  ...
}
```

captured at `as_of: 2026-09-07T18:21:38.143Z` (14:21 ET) — a real intraday clock reading for
an ordinary trading day, computed on a day with no session running at all. A member or Largo
reading `desk_context` alone (it is the sub-object that answers "how long until X") would
believe ~97 minutes remained in a session that never opened.

## Root cause

`buildSpxPlayDeskContext()` (`src/features/spx/lib/spx-play-context.ts`) computes three
countdown fields — `minutesToCashClose`, `minutesUntilNoEntry`, `minutesUntilForceExit` — each
gated by `isEtWeekday(now)` (`spx-play-session-guards.ts`): Saturday/Sunday check only, no
NYSE-holiday check. Labor Day is a Monday, so `isEtWeekday` returns `true` and every countdown
computes off the wall clock as if RTH were live.

This is the exact bug class already fixed elsewhere in this same file's neighborhood —
`isSpxRthActive`/`isSpxEngineCronWindow` in `spx-play-session-guards.ts` carries a 2026-07-03
comment about the identical `isEtWeekday`-only gate false-flagging a P0 on a holiday, and
today's cycle shipped several `isTradingDayEt` cron gates (`swing-discovery`,
`x-growth`/`x-engage`, `platform-warm`, `socket-health`, etc.) — but none of those touched this
specific **desk_context display path**, which is a separate call site with its own local
`isEtWeekday` gate.

## Fix

Swapped `isEtWeekday(now)` for `isTradingDayEt(formatEtDate(now))` (already imported and used
elsewhere in the codebase, from `@/features/nighthawk/lib/session`) in all three countdown
helpers. `isTradingDayEt` checks weekday AND the `US_MARKET_HOLIDAYS` set, so a holiday now
nulls all three fields exactly like a weekend already did — consistent with the rest of the
`/play` payload, which already reports the session as closed.

## Blast radius

`spx-play-context.ts` only — `buildSpxPlayDeskContext`/`enrichPlayPayload`, consumed solely by
`GET /api/market/spx/play`. `isPastNoEntryCutoff`/`isPastForceExitCutoff` (time-of-day-only
cutoff checks, unchanged) are still combined with the new trading-day gate via `||`, so a
holiday nulls the field even before those cutoffs would otherwise fire. No other caller of
`isEtWeekday` was touched — `spx-play-session-guards.ts`'s own weekday-gated windows
(`isLottoWindow`, `isPremarketPlanningWindow`, etc.) are unrelated to this display path and are
out of scope for this fix.

## Fix rationale

Reused the same `isTradingDayEt` used by `isSpxEngineCronWindow` in the sibling file rather
than inventing a second holiday-aware weekday check — one source of truth for "is there a
session today" across the SPX Slayer feature. Left `isPastNoEntryCutoff`/`isPastForceExitCutoff`
untouched since they're pure time-of-day cutoffs already invoked from inside a caller that (post-fix)
short-circuits on non-trading days first.

## Evidence

RED→GREEN via `git stash` on the source file only (test file kept):
```
$ npx tsx --test src/features/spx/lib/spx-play-context.test.ts   # pre-fix (stashed)
not ok — NYSE holiday on a weekday nulls every countdown: expected null, got 99
$ npx tsx --test src/features/spx/lib/spx-play-context.test.ts   # post-fix
ok 5/5 (including the ordinary-trading-day control case)
```
Live evidence: `GET /api/market/spx/play` on production, 2026-09-07 (Labor Day), captured via
a temp premium Clerk session — `desk_context.minutes_to_close: 97` while
`gates.blocks: ["Session closed"]` in the same payload.

`npx tsc --noEmit` clean.
