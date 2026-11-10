# SwingCockpitStrip's "Session P&L" cockpit stat averaged raw open-runner P&L across TRIM plays — the third within-panel contradiction in the same #7834/#7840 bug class

> **kind:** `FINDING`

| | |
|---|---|
| **Status** | FIXED |
| **Severity** | P2 — member-visible, a headline cockpit number that disagreed with the per-card verdict badges it aggregates |
| **Horizon** | Night Hawk Swings (Command Deck, `SwingCockpitStrip.tsx`) |
| **Found via** | Round 521, following up on #7840's own hand-back ("flagged for next round") |

## Summary

PR #7834 fixed `ZeroDteCommandPanel.tsx`'s verdict-band headline P&L badge, and PR #7840 fixed
`TerminalPremiumPanels.tsx`'s `TradeExcursionGraphic` "Current" stat, so an OPEN/HOLD/TRIM **SWING**
position that has already banked a partial trim shows the **blended whole-position P&L**
(`blendedTrimPnlPct`, `terminal-ladder.ts`) instead of the raw, unblended return on the still-open
runner leg only. #7840's own hand-back explicitly flagged a third, unfixed call site for the next
round: `SwingCockpitStrip.tsx`'s "Session P&L" cockpit stat, which sits above every individual play
card and averages `play.pnlPct` directly across every OPEN/HOLD/TRIM play:

```ts
const pnls = working.map((p) => p.pnlPct).filter((n): n is number => n != null && Number.isFinite(n));
```

For a TRIM SWING play with a fired tranche, `p.pnlPct` is still the raw runner-only figure (the
same `livePnlPct` the two prior fixes already corrected for), so this cockpit average silently
pulled in the wrong (overstated, in the live repro's direction) number for any TRIM position in the
book — a within-panel contradiction one level up: the per-card verdict badge shows the correct
blended figure while the strip immediately above the whole deck shows an average contaminated by
the unblended one for the same play.

Verified live via the shared repro all three fixes use (SWING:APP/positionId 2397, entry $17.34,
mark $98.00, one tranche fired at the +100%/50% rung): raw runner-only P&L +465.2%, correct blended
+282.6%. With this play as the sole OPEN/HOLD/TRIM position, the cockpit's "Session P&L" read the
raw +465.2% pre-fix instead of the +282.6% every other fixed surface in the product now agrees on.

## Root cause

Same root cause as #7834/#7840: `play.pnlPct` is sourced from the raw `livePnlPct` derivation
(`live-plays.ts`) and is never re-blended once a trim tranche fires. #7834/#7840 each fixed one
per-play display call site; this is a third, aggregate-level call site with the identical gap — an
average over many plays' own unblended figures is just as wrong as a single unblended figure.

## Fix

Mirrored the same shared helper and scoping both prior fixes used, applied per-play before
averaging:

```ts
const pnls = working
  .map((p) =>
    p.horizon === "SWING"
      ? blendedTrimPnlPct(p.pnlPct, p.exitPolicy?.trim_levels) ?? p.pnlPct
      : p.pnlPct,
  )
  .filter((n): n is number => n != null && Number.isFinite(n));
```

- Scoped to `play.horizon === "SWING"` only, for the identical reason #7834/#7840 scoped their own
  fixes that way — a 0DTE TRIM row's `pnlPct` comes from a different, unaudited server-side path
  (`reconcileLedgerLivePnlPct`) this fix does not touch or re-verify.
- `blendedTrimPnlPct` itself is a no-op (returns `null`, falling back to the raw figure) whenever
  no tranche has fired yet, so a cockpit with no banked trims anywhere in the book is provably
  unaffected — confirmed by a dedicated regression test.
- Left `openCount`/`watchCount`/`buyCount`/`regime` untouched — this fix only touches the P&L
  average's own inputs.

## Evidence

RED→GREEN: `git stash` isolated the source change while keeping the new test file — the TRIM-blend
assertion failed pre-fix (actual `+465.2%`, expected `+282.6%`) while the sibling no-trim-fired and
non-SWING-horizon assertions in the same test file both passed pre-fix, proving the fix is additive.
Restored the fix: `SwingCockpitStrip.ssr.test.ts` 3/3 pass. Full sibling-suite run
(`ZeroDteCommandPanel.test.ts`, `terminal-ladder.test.ts`, `swing-cockpit-utils.test.ts`,
`TerminalPremiumPanels.ssr.test.ts`, `play-card-lifecycle.test.ts`): 102/102 pass. `npx tsc --noEmit`
clean, Node 20.

## Blast radius

This closes the specific follow-up #7840 flagged. A fresh sweep of `command-deck/*.tsx` for other
independent `pnlPct`/`peak`/`trough` re-derivations found one unreachable dead-code path
(`CommandDeck.tsx`'s pre-`useLifecyclePlayCard` fallback JSX — `useLifecyclePlayCard()` always
returns `true`, so that branch never renders; not fixed here, not a live bug) and one further
**real, reachable** instance: `openMetricsValues()` (`play-card-lifecycle.ts`), which feeds
`playListReturnPct()` → `PlayLifecycleCardBody`'s list-row "Current"/"PNL" column — the primary
per-play list row shown on every Command Deck, not a detail-panel surface. For non-LEGACY horizons
it returns `currentPct: play.pnlPct ?? null`, the same raw unblended figure, for every SWING TRIM
row in the list. Deliberately left out of THIS PR (different file, different shared helper
boundary, its own blast radius) — flagged for a separate, single-issue follow-up PR per the
hand-back.
