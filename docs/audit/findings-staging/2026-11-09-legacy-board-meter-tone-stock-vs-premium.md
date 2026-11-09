# 2026-11-09: Night Hawk Legacy board's "Target path" meter colors a live premium return by the stock's sign, not the premium's

> **kind:** `FINDING`

**Status.** FIXED — this PR.

## Summary

`legacyBoardMeter()` (`src/features/nighthawk/lib/legacy-board-table-utils.ts`) builds the
`VectorBoardMeter` shown in the Legacy board's "Target path" column
(`legacy-board-columns.tsx:194`, rendered live for every row via `<VectorBoardMeter
meter={legacyBoardMeter(row)} />`). For a row that has `progressPct` set (the underlying stock has
moved some % of the way toward its published target/stop), the function builds its `valueLabel`
correctly — it prefers the real, live **option-premium** return (`row.premiumPct`) whenever one
exists, and falls back to the underlying stock's move only when it doesn't:

```ts
const premiumLabel = pct != null ? formatPremiumPct(pct) : null;
return {
  valueLabel: premiumLabel ?? formatPremiumPct(stockMove),
  ...
  tone: stockTone === "bull" ? "up" : stockTone === "bear" ? "down" : "flat",
};
```

But the returned **`tone`** (the up/down/flat color) was taken from `stockTone` (derived from
`row.play.stockMovePct`) **unconditionally**, regardless of which number `valueLabel` actually
settled on. `progressPct` (how far the stock has moved toward target/stop,
`overlayLegacyQuotes`/`terminalPlayToLegacyRow`) and `premiumPct` (the live option mark's % return,
`overlayLegacyOptionMarks`) are computed independently of each other — so an actively tracked OPEN
Legacy row with both a live stock quote and a live option mark carries both non-null at once (the
common case for a fully-quoted open position, not an edge case — the same two-overlay composition
`play-card-display.ts`'s `primaryReturnLabel` fix documents for the identical pair of fields).
Whenever the premium and the underlying disagreed in sign — routine, since an option has its own
vol/skew/decay dynamics independent of the stock's own tick — the meter showed a **positive**
premium return in a **bearish/red** tone, or a **negative** premium return in a **bullish/green**
tone, directly contradicting the number sitting right next to it.

## Root cause

A `tone` variable derived from the correct field (`pct`, i.e. `premiumPct`) was computed at the top
of the function and used correctly in the function's other two return branches (the
`pct >= 50` floor case and the generic premium-path case below), but the `progressPct != null`
branch introduced a second, stock-derived `stockTone` and used *that* unconditionally instead,
without checking whether `valueLabel` was actually showing the premium or the stock fallback.

This diverged from the sibling generic `vectorBoardMeter()` (`vector-board-table-utils.ts`, used by
the 0DTE/other boards' identical "Target path" column via `vector-board-columns.tsx`), which gets
this right — it colors its own `progressPct` branch off the same `pct`-derived `tone` it uses
everywhere else in the function, because non-Legacy rows have no separate "stock" concept to
confuse it with. The Legacy-specific copy added the stock fallback for `valueLabel` correctly, but
the tone fix didn't travel with it.

## Evidence (RED → GREEN)

RED (pre-fix, via `git stash` isolating only the `legacy-board-table-utils.ts` source change, the
new regression tests left in place):

```
legacyBoardMeter colors the Target-path meter by the PREMIUM's sign when a live option mark
exists, not the stock's
  tone must follow the premium's sign (up) since that's the number actually shown — got "down"...
  'down' !== 'up'
```
18/19 pass, 1 fail in `legacy-board-table-utils.test.ts`.

GREEN (post-fix, `git stash pop` restores the fix):

- `legacy-board-table-utils.test.ts`: 19/19 pass (added a second test confirming the no-live-mark
  case still correctly colors by the stock's sign).
- Full sweep, `src/features/nighthawk/lib/*.test.ts` + `src/features/nighthawk/components/*.test.ts`
  (1719 tests across 49 suites): all pass.
- `npx tsc --noEmit`: clean.

## Fix

Introduced `activeTone = pct != null ? tone : stockTone` in the `progressPct != null` branch, so
the tone follows exactly the same precedence `valueLabel` already uses: the premium's own tone
whenever a live option mark exists, falling back to the stock-derived tone only in the genuine
stock-only case (no live mark yet). Minimal, single-branch change — the other two branches
(`pct >= 50` floor, generic premium path) were already correct and untouched.

## Blast radius

Grepped every consumer of `VectorBoardMeter`/`vectorBoardMeter`/`legacyBoardMeter` repo-wide:
`vectorBoardMeter` (the 0DTE/other-board sibling, `vector-board-table-utils.ts`) was independently
confirmed already correct — it has no separate stock-move concept to introduce this exact
divergence, and its own `progressPct` branch already uses the single `tone` consistently. No other
copy of `legacyBoardMeter` exists. The only live render site is
`legacy-board-columns.tsx`'s "Target path" column, rendered for every Legacy board row via the
shared `VectorBoardMeter` component.
