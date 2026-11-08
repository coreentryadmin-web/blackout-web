# 0DTE governor "time-of-day" sizing label fires on non-trading days (wall-clock only, no trading-day gate)

> **kind:** FINDING

## Summary
The 0DTE board's governor strip (`ZeroDteBoard.tsx`'s "Window" pill) showed `lunch chop —
fade-prone, size down` on a **Sunday** (2026-11-08, ~13:10 ET) — a day with no live session, no
setups, and `governor.open_plans: []`. The label implies active intraday risk-sizing guidance on
a day the market was not even open.

## Root cause
`timeOfDaySizingFactor()` (`src/lib/zerodte/governor.ts`) derives its `label`/`factor` purely from
the ET wall-clock minute, with no concept of whether today is a trading day. Its caller,
`summarizeGovernorForBoard()`, called it unconditionally on every board fetch. Meanwhile
`buildZeroDteBoardPayload()` (`src/lib/platform/zerodte-service.ts`) already computes
`isTradingDayEt(today)` for the sibling `sessionHeat()` call a few lines above, but never passed
it into `summarizeGovernorForBoard`. `ZeroDteBoard.tsx`'s `GovPill label="Window"` renders
`gov.time_of_day_label` unconditionally whenever it's truthy, with no trading-day check of its
own — so the mismatch reached members directly.

This is the same bug shape as the 2026-11-01 fix already documented in this file's own header
comment (factor/label disagreeing across the pre-market boundary) — a time-derived field computed
without the gate its sibling field already uses.

## Fix
- `summarizeGovernorForBoard()` gains an `isTradingDay?: boolean` opt (default `true`, so every
  existing caller/test that predates this param keeps its current weekday-shaped behavior).
  When `false`, it short-circuits to the same no-op shape the pre-market case already returns:
  `{ factor: 1, label: null, effective_max_concurrent: GOVERNOR_MAX_CONCURRENT_PLANS }`.
- `buildZeroDteBoardPayload()` now passes its already-computed `tradingDay` flag through.

## Evidence
- Live repro: `GET /api/market/zerodte/board` on Sunday 2026-11-08 ~13:10 ET served
  `governor.time_of_day_label: "lunch chop — fade-prone, size down"` alongside `open_plans: []`,
  `session.trading_day: false`.
- RED: added test fails against the pre-fix source (72 tests, 1 fail) — confirmed by stashing just
  `governor.ts`/`zerodte-service.ts` and re-running `governor.test.ts`.
- GREEN: same test passes post-fix (72/72); a sibling test confirms the label still fires
  correctly on a real trading day at the identical ET minute (no over-correction), and a third
  confirms omitting the new param preserves prior behavior exactly.
- `npx tsc --noEmit` clean.
- Full regression: `src/lib/zerodte/*.test.ts` + `src/lib/platform/zerodte-service.test.ts` —
  1814/1814 pass (1 pre-existing skip, unrelated).

## Blast radius
Only the 0DTE board's governor strip display. `GOVERNOR_ENFORCE_TOD_SIZING` defaults off, so this
never affected real position sizing — purely a misleading disclosure pill on non-trading days.
`timeOfDaySizingFactor()` itself is left unchanged (still a pure, day-agnostic helper); the gate
lives at the board-serving boundary, matching where `sessionHeat()` is already gated the same way.

| **Status** | FIXED — this PR. |
