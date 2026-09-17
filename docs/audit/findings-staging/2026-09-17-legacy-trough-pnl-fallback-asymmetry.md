## 2026-09-17 — [FINDING, FIXED] `legacyPrimaryTroughPct` fell back to `null` where `legacyPrimaryPeakPct` correctly fell back to the live P&L

> **kind:** `FINDING`

| | |
|---|---|
| **Status** | FIXED |
| **Severity** | P3 — a real member-facing display gap (a populated "Best" next to a blank "Worst" on a freshly-opened Legacy position), no financial-calculation or grading impact |
| **Lane** | Night Hawk Legacy |
| **PR** | fix/legacy-trough-pnl-fallback-asymmetry |

### Root cause

`legacy-primary-pnl.ts`'s two excursion helpers are meant to be mirror images of each
other — "best move so far" and "worst move so far" — but their fallback chains diverged:

```ts
export function legacyPrimaryPeakPct(play: TerminalPlay): number | null {
  if (play.pnlPct != null && Number.isFinite(play.pnlPct)) {
    return play.peak ?? play.pnlPct;   // <-- falls back to the live P&L
  }
  return play.stockPeakPct ?? play.peak ?? null;
}

export function legacyPrimaryTroughPct(play: TerminalPlay): number | null {
  if (play.pnlPct != null && Number.isFinite(play.pnlPct)) {
    return play.trough ?? null;        // <-- falls back to null, NOT play.pnlPct
  }
  return play.stockTroughPct ?? play.trough ?? null;
}
```

For a freshly-opened option-based Legacy position, `pnlPct` is live (computed on every
read) but `peak`/`trough` are persisted state set by the live-sync cron
(`peak_premium`/`trough_premium` in `discord_live_state`) — there is a real window, right
after BTO and before the first live-sync tick, where `pnlPct` is populated but `peak`/
`trough` are not yet. In that window, `legacyPrimaryPeakPct` correctly reasons "nothing
better has been seen yet, so the best-so-far is the current P&L" and returns `pnlPct`.
`legacyPrimaryTroughPct` should reason identically for the worst-so-far, but instead
returned `null` — an honest "no data" answer for a value the current P&L already answers.

### Evidence

Grepped real consumers: `TerminalPremiumPanels.tsx:285-286` computes `worst =
legacyPrimaryTroughPct(play)` and `best = legacyPrimaryPeakPct(play)` side by side for
the same play object, and `LegacyPlayDetailPanel.tsx` imports both. For a fresh position
this rendered a populated "Best" next to a blank "Worst" — the same underlying
data-availability state answered two different ways depending on which side of the
best/worst pair it was.

No existing test exercised the "no peak/trough latched yet" branch of either function
(the two existing tests both passed an explicit `peak` value), and `legacyPrimaryTroughPct`
had zero test coverage at all before this fix.

### Fix

Changed `legacyPrimaryTroughPct`'s fallback to `play.trough ?? play.pnlPct`, mirroring
`legacyPrimaryPeakPct` exactly. No other behavior changes — a play that already has a
latched `trough` is unaffected.

### Blast radius

Single function, two real UI consumers (`TerminalPremiumPanels.tsx`,
`LegacyPlayDetailPanel.tsx`) and one internal consumer
(`play-card-lifecycle.ts` only imports the peak helper, not trough, so it is
unaffected).

### Tests

Added four tests: the RED case (trough falls back to `pnlPct` when unlatched — failed
against the original source with `null !== -8`), a matching peak-fallback test that
was previously untested, a latched-trough case, and a no-option-P&L stock-fallback case.
RED confirmed via `git stash` isolating just the source fix; GREEN confirmed after
restoring it (6/6 passing). `tsc --noEmit` clean.
