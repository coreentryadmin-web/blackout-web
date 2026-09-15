> **kind:** FINDING

## Night Hawk Legacy's carry-until-close (and 3 sibling callers) used a hardcoded 4pm ET close, wrong on NYSE early-close half-days — FIXED

| **Status** | FIXED (PR #5026) |
|---|---|

**Root cause:** `isBeforeOrAtMarketCloseEt` (`src/features/nighthawk/lib/session.ts`) hardcoded
`mins <= 16 * 60` (4:00 PM ET) as the session-close boundary for every trading day, with no
awareness of NYSE early-close half-days (Black Friday, Christmas Eve — 1:00 PM ET close). This one
function gates four real call sites: `edition/route.ts`'s `carry_until_close` (whether Legacy keeps
showing yesterday's plays as still live for today's board), `mobile/signals/route.ts`'s identical
carry check for the mobile app, `publish-gates.ts`'s trading-day window selection, and
`agents/day-trade-agent.ts`'s day-open/closed detection (used inverted). On an early-close day, all
four would misjudge the market as still open for three extra hours (1:00–4:00 PM ET) past the real
close.

**Evidence this asymmetry is real, not intended:** `src/lib/et-market-hours.ts`'s `isEtCashRth` is
explicitly documented ("prefer isEtCashRth for early-close correctness") as the fixed, canonical
replacement for the now-`@deprecated` `isEtMarketHours` — i.e. this exact early-close gap was
already found and fixed once for the RTH gate, but `session.ts`'s sibling close-boundary check was
never updated to match. Confirmed live: `spx-play-session-guards.ts`'s own `EARLY_CLOSE_DATES` table
(Black Friday/Christmas Eve, 2025-2027) has no counterpart anywhere in `session.ts`.

**Fix rationale:** The obvious fix — importing `spx-play-session-guards.ts`'s
`getEarlyCloseMinutes()` — was rejected because that module already imports
`isTradingDayEt`/`formatEtDate` FROM `session.ts`, so importing its early-close table back here
would create a circular module dependency. Instead, `session.ts` carries its own small early-close
table (`EARLY_CLOSE_ET_MINUTES`, the same 6 dates as `spx-play-session-guards.ts`'s
`EARLY_CLOSE_DATES`), self-contained, no new cross-module dependency — matching the existing pattern
already in this exact file (`US_MARKET_HOLIDAYS` is already its own independently-maintained
calendar here, not imported from elsewhere). The two tables must be kept in sync going forward —
noted in-code on both sides with a cross-reference comment.

**Blast radius:** Every caller of `isBeforeOrAtMarketCloseEt` (4 files, listed above) gets the fix
for free, since they all go through this one shared function. No other logic changed — normal
trading days are byte-identical (the existing "keeps active through session close" 4pm-ET test still
passes unchanged).

**Verified:** git-stash RED→GREEN proof (2/17 new+existing tests in `session.test.ts` fail with the
fix reverted, 17/17 pass with it restored), `npx tsc --noEmit` clean, full `npm test` on Node 20 —
14292 pass / 0 fail / 3 skipped.

**Urgency:** Low — next affected date is Black Friday 2026-11-27, ~10 weeks from this fix. Flagged
and fixed now while there's time to spare, per the standing audit discipline of sweeping
proactively rather than waiting for it to actually break.
