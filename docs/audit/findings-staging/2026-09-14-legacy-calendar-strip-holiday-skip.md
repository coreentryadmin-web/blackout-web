> **kind:** FINDING

## Legacy edition calendar strip included NYSE market holidays as session tiles — FIXED

| **Status** | FIXED (PR fix/legacy-calendar-strip-holiday-skip) |
|---|---|

**Root cause.** `legacyEditionSessionDates` (`src/features/nighthawk/lib/legacy-board-calendar.ts`)
filtered candidate calendar-strip dates on a bare Saturday/Sunday day-of-week check
(`getUTCDay() !== 0 && !== 6`), not the shared `isTradingDayEt` predicate (`session.ts`) that every
other Legacy date helper in this codebase uses — which also excludes NYSE market holidays via
`US_MARKET_HOLIDAYS`. A market holiday never has a real Legacy edition (nothing publishes that
day), so including one as a calendar tile silently understated the "14 trading days back" the
function's own doc comment promises — by one slot per holiday inside the requested window.

**Evidence.** The existing, passing test for this function asserted `2026-09-07` (Labor Day, a
real NYSE closure present in `session.ts`'s `US_MARKET_HOLIDAYS` set) as a valid session tile —
pinning the buggy behavior in place rather than catching it. Confirmed the fix changes this: with
the swap to `isTradingDayEt`, the same 5-tile window now correctly excludes 2026-09-07 and walks
back one extra day to 2026-09-04 to still return the full requested count of real trading days.

**Blast radius.** Contained to this one function. `legacyEditionCalendarBuckets` (the sibling
function in the same file) takes whatever dates list it's given and has no trading-day logic of
its own, so it needed no change. `isTradingDayEt` is the same shared predicate already used by
`legacy-edition-dates.ts` and `legacy-live-sync.ts`'s `priorTradingDayYmd` — no new logic
introduced, just applying the existing correct predicate at this one remaining call site that had
drifted to a narrower ad-hoc check.

**Fix.** Swapped the inline weekend check for `isTradingDayEt(session)`. The walk-back loop's
existing `guard` bound (`count * 4` iterations) already comfortably absorbs the extra day(s) a
holiday-dense window costs, so the strip still returns the full requested `count` of real trading
days rather than coming up short.

**Severity/impact.** Low — a member-facing calendar strip UX precision gap (an off-by-one-per-
holiday miscount of "how far back" the strip actually reaches), not a data-correctness or
financial-calculation defect. No live position management, grading, or P&L logic touches this
function.

**Test evidence.** Updated the existing test's fixed expectation and added a new explicit
regression test naming Labor Day directly (`legacy-board-calendar.test.ts`). RED confirmed via the
pre-fix code (the existing test asserted the old, buggy 2026-09-07-included expectation). GREEN
post-fix: 4/4 pass in this file. Full suite on Node 20: 14190 pass / 0 fail / 3 skipped
(pre-existing, unrelated). `npx tsc --noEmit` clean.
