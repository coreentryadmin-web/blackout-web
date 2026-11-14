# `openMetricsValues()`'s list-row "Current"/"PNL" column showed the raw open-runner P&L for a SWING TRIM play — the fourth within-panel contradiction in the #7834/#7840/#7866 bug class

> **kind:** `FINDING`

| | |
|---|---|
| **Status** | FIXED |
| **Severity** | P2 — member-visible, the primary per-play list-row figure disagreed with the same play's own card verdict badge |
| **Horizon** | Night Hawk Swings (Command Deck, `play-card-lifecycle.ts`) |
| **Found via** | Round 524, following up on #7840's/#7866's own hand-back ("flagged for next round") |

## Summary

PR #7834 fixed `ZeroDteCommandPanel.tsx`'s verdict-band headline P&L badge, PR #7840 fixed
`TerminalPremiumPanels.tsx`'s `TradeExcursionGraphic` "Current" stat, and PR #7866 (open at time of
writing) fixes `SwingCockpitStrip.tsx`'s "Session P&L" cockpit average — all three so an OPEN/HOLD/
TRIM **SWING** position that has already banked a partial trim shows the **blended whole-position
P&L** (`blendedTrimPnlPct`, `terminal-ladder.ts`) instead of the raw, unblended return on the still-
open runner leg only. #7840's and #7866's own hand-backs explicitly flagged a fourth, unfixed call
site for a follow-up round: `play-card-lifecycle.ts`'s `openMetricsValues()`, which feeds
`playListReturnPct()` → `PlayLifecycleCardBody`'s list-row "Current"/"PNL" column — the primary
per-play row shown on every Command Deck list, not a detail-panel surface:

```ts
return {
  currentPct: play.pnlPct ?? null,
  peakPct: play.peak ?? null,
};
```

For a TRIM SWING play with a fired tranche, `play.pnlPct` is still the raw runner-only figure (the
same `livePnlPct` the three prior fixes already corrected for elsewhere), so the list row's primary
"Current"/"PNL" number silently disagreed with the SAME play's own verdict-band badge (#7834) and
`TradeExcursionGraphic` stat (#7840) — a within-panel contradiction one level up from either of
those, and the most-visible one yet: it is the number shown on every row of the Command Deck list,
not a number that only appears once a card is expanded.

Verified via the shared repro all three sibling fixes use (SWING:APP, entry $17.34, mark $98.00,
one tranche fired at the +100%/50% rung): raw runner-only P&L +465.2%, correct blended +282.6%.
Pre-fix, the list row showed +465.2%.

## Root cause

Same root cause as #7834/#7840/#7866: `play.pnlPct` is sourced from the raw `livePnlPct` derivation
(`live-plays.ts`) and is never re-blended once a trim tranche fires. The three prior fixes each
corrected one display call site reading that field directly; this is a fourth, and the one with the
widest reach — `openMetricsValues()` is the shared helper every Command Deck list row calls through
`playListReturnPct()`, so the bug was live on every SWING TRIM row in the list simultaneously, not
just a detail panel a member had to open.

## Fix

Mirrored the same shared helper and scoping all three prior fixes used:

```ts
const currentPct =
  play.horizon === "SWING"
    ? blendedTrimPnlPct(play.pnlPct, play.exitPolicy?.trim_levels) ?? play.pnlPct ?? null
    : play.pnlPct ?? null;
return {
  currentPct,
  peakPct: play.peak ?? null,
};
```

- Scoped to `play.horizon === "SWING"` only, for the identical reason #7834/#7840/#7866 scoped
  their own fixes that way — a 0DTE TRIM row's `pnlPct` comes from a different, unaudited
  server-side path (`reconcileLedgerLivePnlPct`) this fix does not touch or re-verify.
- `blendedTrimPnlPct` itself is a no-op (returns `null`, falling back to the raw figure) whenever
  no tranche has fired yet, so a card with no banked trim is provably unaffected — confirmed by a
  dedicated regression test.
- LEGACY's own branch (`legacyPrimaryPnlPct`/`legacyPrimaryPeakPct`) is untouched — it was already
  correct and out of scope.
- `peakPct` is untouched — only `currentPct`'s derivation changes.

## Evidence

RED→GREEN: `git stash` isolated the source change while keeping the new test file — the two new
SWING-trim-blend assertions failed pre-fix (actual `+465.2%`, expected `+282.6%`) while the sibling
no-trim-fired and 0DTE-untouched assertions in the same new `describe` block both passed pre-fix,
proving the fix is additive and correctly scoped. Restored the fix: `play-card-lifecycle.test.ts`
64/64 pass. Sibling suite (`ZeroDteCommandPanel.test.ts`, `TerminalPremiumPanels.ssr.test.ts`,
`terminal-ladder.test.ts`): 40/40 pass. `npx tsc --noEmit` clean, Node 20.

## Blast radius

This closes the specific follow-up #7840/#7866 flagged. A fresh sweep of `command-deck/*.tsx` for
other independent `pnlPct`/`peak`/`trough` re-derivations found one candidate already identified and
correctly ruled out by #7866's own finding: `CommandDeck.tsx`'s pre-`useLifecyclePlayCard` fallback
JSX (`p.pnlPct` in its raw "MID"/"PnL" badge) is dead code — `useLifecyclePlayCard()` is hardcoded
to always return `true`, so that branch never renders. `PlayLifecycleCard.tsx` itself reads no raw
`pnlPct`/`peak`/`trough` fields directly — only this file's helper functions — so no further live
instance was found in `command-deck/*.tsx` at this time.
