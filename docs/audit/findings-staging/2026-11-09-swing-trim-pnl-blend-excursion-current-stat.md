# TradeExcursionGraphic's "Current" stat still showed the raw open-runner P&L for an OPEN SWING TRIM row — a within-panel contradiction against the verdict badge #7834 just fixed

> **kind:** `FINDING`

| | |
|---|---|
| **Status** | FIXED |
| **Severity** | P2 — member-visible, two contradicting headline P&L numbers in the SAME card |
| **Horizon** | Night Hawk Swings (Command Deck, shared `ZeroDteCommandPanel.tsx` / `TerminalPremiumPanels.tsx`) |
| **Found via** | Fresh whole-product sweep, round 518, following up on #7834's own blast-radius note |

## Summary

PR #7834 (merged earlier this session) fixed `ZeroDteCommandPanel.tsx`'s verdict-band headline
P&L badge so an OPEN/HOLD/TRIM **SWING** position that has already banked a partial trim shows
the correct **blended whole-position P&L** (`blendedTrimPnlPct`, `terminal-ladder.ts`) instead of
the raw, unblended return on the still-open runner leg only.

That fix was applied to exactly one derivation (`swingTrimBlendedPct` inside
`ZeroDteCommandPanel.tsx`). But `ZeroDteCommandPanel.tsx` mounts a SECOND component for the SAME
play, in the SAME card, a few lines below the verdict band:
`hasEntry && !isCandidate` renders `<TradeExcursionGraphic play={play} markFlash={markFlash} />`
(`TerminalPremiumPanels.tsx`). That component computes its own "Current" stat independently:

```ts
const currentPct = closed ? closedRealizedPct(play) : legacyPrimaryPnlPct(play);
```

`legacyPrimaryPnlPct` (`legacy-primary-pnl.ts`) is a plain `play.pnlPct ?? play.stockMovePct ??
null` — it never blends a banked trim tranche, for any horizon. So for the exact live repro #7834
already measured (SWING:APP/positionId 2397, entry $17.34, mark $98.00, one tranche fired at the
+100%/50% rung), the verdict band now correctly shows the blended **+282.6%**, while the
`TradeExcursionGraphic` "Current" stat rendered two inches below it in the SAME panel still showed
the raw **+465%** (`formatExcursionPct` rounds to whole percent above 10% magnitude) — a direct
within-panel contradiction, the exact failure mode PR #6619 already fixed for the analogous CLOSED
case (`closedRealizedPct` vs a bare `exitPnlPct ?? pnlPct` ternary) in this same component.

8/40 live committed SWING positions shared this exact TRIM state at the time #7834 was audited, so
this is not a corner case — it is the same population, hitting a second unfixed call site.

## Root cause

`TradeExcursionGraphic` (`TerminalPremiumPanels.tsx`) derives its own `currentPct` independently of
`ZeroDteCommandPanel.tsx`'s verdict-band `pnlPct` — the two components share the same `play` prop
but never shared the derivation. #7834's fix note explicitly flagged the risk of fixing this at the
shared `TerminalPlay.pnlPct` adapter level (it would have mismatched `play-brief.ts`'s own
still-unblended watermark math for MFE/giveback) and deliberately scoped the fix to "the display
layer only, in `ZeroDteCommandPanel.tsx`" — but didn't extend that same display-layer treatment to
the sibling component that renders in the identical panel for the identical play.

## Fix

Mirrored #7834's exact pattern inside `TradeExcursionGraphic`:

```ts
const currentPct = closed
  ? closedRealizedPct(play)
  : play.horizon === "SWING"
    ? blendedTrimPnlPct(play.pnlPct, play.exitPolicy?.trim_levels) ?? legacyPrimaryPnlPct(play)
    : legacyPrimaryPnlPct(play);
```

- Scoped to `play.horizon === "SWING"` only, for the identical reason #7834 scoped its own fix
  that way: a 0DTE TRIM row's `pnlPct` comes from a different, unaudited server-side path
  (`reconcileLedgerLivePnlPct`), and re-blending it here risks an unmeasured double-blend.
- `blendedTrimPnlPct` itself no-ops (returns `null`) whenever no tranche has fired yet, so a
  fully-OPEN/HOLD SWING position with no banked trim is provably unaffected — same for CLOSED
  (routed through the separate, pre-existing `closedRealizedPct` branch) and ZERO_DTE/LEGACY.
- Deliberately left `legacyPrimaryPeakPct`/`legacyPrimaryTroughPct` (the "Peak"/"Worst" stats)
  untouched — same scoping #7834 itself used: the blend applies only to the headline live P&L
  figure, never to the peak/trough watermarks, which stay on the raw mechanical basis everywhere
  else in the product (play-brief.ts's MFE/giveback math reads the same raw watermarks).

## Evidence

RED→GREEN: `git checkout -- TerminalPremiumPanels.tsx` reverted the source fix while keeping the
new tests; the TRIM-blend assertion failed pre-fix (`actual '+465%' / expected '+283%'`) while the
sibling no-trim-fired and ZERO_DTE-scope assertions in the same new block both passed pre-fix,
proving the fix is additive (not required for either sibling case to already pass). Restored the
fix: `TerminalPremiumPanels.ssr.test.ts` 8/8 pass. Full sibling-suite run (`ZeroDteCommandPanel.test.ts`,
`terminal-ladder.test.ts`, `play-card-lifecycle.test.ts`, `trade-excursion-graphic.test.ts`,
`legacy-primary-pnl.test.ts`): 109/109 pass. `npx tsc --noEmit` clean, Node 20.

## Blast radius

Checked every other `.pnlPct` reader in `command-deck/` for the same gap
(`SwingCockpitStrip.tsx`, `PlayTimelinePanel.tsx`, `PlayTerminal.tsx`, `CommandDeck.tsx`):
`SwingCockpitStrip.tsx`'s "Session P&L" cockpit stat also averages raw `play.pnlPct` across
OPEN/HOLD/TRIM SWING plays — a candidate for a follow-up, flagged in the hand-back for the next
round rather than bundled into this single-issue PR (it is a different consumer with a different
aggregation shape — an average across many plays, not a single play's headline figure — and
deserves its own focused fix/test rather than widening this PR's blast radius).
