# 2026-11-09: Night Hawk Command Deck list row mislabeled real Legacy option P&L as "Stock"

> **kind:** `FINDING`

**Status.** FIXED — this PR.

## Summary

The Command Deck's compact list-row card (`PlayLifecycleCardBody`, `PlayLifecycleCard.tsx` —
shared by every lane's table/list view: 0DTE, Swings, Legacy) shows a return figure (`ret`,
computed by `playListReturnPct`, `play-card-lifecycle.ts`) next to a small label chosen by
`primaryReturnLabel` (`play-card-display.ts`). For a Legacy OPEN play, that label used to be
decided purely by `play.stockMovePct != null`:

```ts
if (play.horizon === "LEGACY") {
  if (play.status === "CLOSED") return "Peak Return";
  return play.stockMovePct != null ? "Stock" : "P&L";
}
```

`stockMovePct` is stamped **unconditionally** on every Legacy play with a resolvable entry band
by `overlayLegacyQuotes` (`use-legacy-quotes.ts`) — and critically, the real pipeline composes the
two Legacy overlays as `overlayLegacyOptionMarks(overlayLegacyQuotes(plays, ...), marks)`
(`containers.tsx:451-452`): the stock overlay runs first and nulls `pnlPct`/leaves `stockMovePct`
set, then the option-marks overlay runs second and — when a real live option mark exists —
restores a genuine, non-null `pnlPct`. It does **not** clear `stockMovePct` when it does this. So
`stockMovePct != null` is true for essentially every OPEN Legacy row, including the normal,
majority case where a real live option mark is available and the row's actual P&L comes straight
from `pnlPct`.

Meanwhile the VALUE actually shown beside that label (`playListReturnPct` → `openMetricsValues` →
`legacyPrimaryPnlPct`, which already correctly prefers `play.pnlPct` over `play.stockMovePct`) was
the real option premium return. Net effect: **a Legacy OPEN play with a working live option mark
displayed its genuine option P&L percentage under the label "Stock"** — telling the member the
number is a stock-level approximation when it is in fact the real, tracked position return.

## Root cause

`primaryReturnLabel`'s LEGACY branch checked *presence of a stock-derived number* instead of
checking *which number is actually being displayed*. Those two questions diverge precisely because
`stockMovePct` is a leftover artifact of the stock overlay that survives into rows whose `pnlPct`
later gets a real value from the option-marks overlay — the field's mere presence says nothing
about whether it is the number currently in use.

The correct check already exists elsewhere in the same codebase: CommandDeck.tsx's own card body
(`~line 872`, a *different* render path for the same data) gets this right —
`<span>{p.pnlPct != null ? "Premium" : "Stock"}</span>` — by checking `pnlPct != null`, the actual
signal for which number is live. `primaryReturnLabel` (used by the separate `PlayLifecycleCardBody`
list-row path) never got the matching fix.

## Evidence (RED → GREEN)

RED (pre-fix, via `git stash` isolating only the `play-card-display.ts` source change, the two new
regression tests left in place):

```
# Subtest: primaryReturnLabel: a LEGACY OPEN row with a real live option mark reads P&L, not Stock
not ok 10 - ...
  error: a real option pnlPct must label as P&L even though stockMovePct is also stamped
  'Stock' !== 'P&L'
# tests 11 / pass 10 / fail 1
```

GREEN (post-fix, fix restored from the stash):

```
# tests 11 / pass 11 / fail 0
```

Also ran every sibling suite that touches `primaryReturnLabel`/`playListReturnPct`/
`legacyPrimaryPnlPct` together (`CommandDeck.ssr.test.ts`, `PlayTerminal.ssr.test.ts`,
`play-card-lifecycle.test.ts`, `play-card-display.test.ts` — 115 tests) and the full
`src/features/nighthawk/command-deck/*.test.ts` battery (505 tests): all pass.
`npx tsc --noEmit`: clean.

## Fix

Changed the LEGACY branch's condition from `play.stockMovePct != null` to `play.pnlPct != null`,
mirroring the already-correct, already-shipped pattern at CommandDeck.tsx:872:

```ts
return play.pnlPct != null ? "P&L" : "Stock";
```

Kept the output strings ("P&L" / "Stock" / "Peak Return" / "Since flag") unchanged — this is a
one-line condition fix, not a copy change. The "no live mark yet, show the stock-level number
under an honest 'Stock' label" case (the ORIGINAL intent of this branch, when `pnlPct` really is
null) is preserved and covered by a second new regression test.

## Blast radius

- `primaryReturnLabel` (`play-card-display.ts`) — the only place this exact bug lived.
- Rendered by `PlayLifecycleCardBody` (`PlayLifecycleCard.tsx`), the shared table/list-row
  component for every Command Deck lane (0DTE/Swings/Legacy); only the LEGACY branch is affected
  (0DTE/Swings always return the flat "P&L" string from this function already).
- Checked the sibling, already-correct call site at CommandDeck.tsx:872 (`p.pnlPct != null ?
  "Premium" : "Stock"`) — confirmed it does NOT share this bug (already keys off `pnlPct`, the
  right signal) and was the reference used to fix this one.
- Checked `primaryReturnPct` (same file) for the identical mis-check — it does not reproduce this
  bug (it never reads `stockMovePct` at all; it is a separate, currently-dead function with no
  production call site outside tests, so it was left alone as out of scope — no behavior change
  without a real caller to prove it against).
- No other consumer of `stockMovePct`/`primaryReturnLabel` found with the same defect — the other
  Legacy call sites that read `stockMovePct` (`legacy-board-columns.tsx`'s "Stock move" column,
  `LegacyPlayManageRail.tsx`'s "Stock move" bullet, `legacyBoardMeter`'s fallback caption) each
  render it under its own explicitly-labeled, disclosed "Stock move" / "not option P&L" UI element,
  never substituting for a real P&L label — those are a different, correctly-disclosed design, not
  an instance of this bug.
