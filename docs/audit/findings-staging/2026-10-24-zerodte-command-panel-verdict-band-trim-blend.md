> **kind:** FINDING

## `ZeroDteCommandPanel`'s verdict-band headline and RATCHET-track marker both skipped the trim-scale as-managed blend, contradicting the SAME panel's own "Trade outcome" section

| **Status** | FIXED |
|------------|-------|

**Symptom:** standing Ask Largo × Night Hawk Swings ownership mandate (extends to the whole Night
Hawk product — 0DTE, Swings, Legacy, LEAPS). `ZeroDteCommandPanel.tsx` is the Command Deck's
0DTE/SWING detail panel. Its "Trade outcome" section (the CLOSED-only "what happened" block, built
for the roadmap brief's Post-Trade Attribution framing) already computes `realizedPct` via
`closedRealizedPct(play)` — the as-managed outcome, preferring the recorded exit stamp, then the
trim-scale blend for a `closedReason: "stopped"` row with armed tranches, then raw live P&L as the
last resort. But the verdict band at the very TOP of the same panel — the first number a member
sees — read `play.pnlPct` directly, with no CLOSED-aware handling at all, and the RATCHET
stop→target track's marker position (`managementFor(...).progress`) was fed that same raw value.
For a CLOSED, stopped 0DTE play whose trim tranches had already armed before the final stop (e.g.
`peak: 87.3`, `closedReason: "stopped"`, no `exitPnlPct`), the panel showed **two disagreeing
numbers for the same trade in the same view**: the verdict band's headline read the raw mechanical
`-50.0%` stop pin while the Trade-outcome section a few lines below correctly read `+6.7%`, and the
RATCHET marker sat pinned at the far-left `STOP` end instead of near the middle where the real
outcome landed.

**Root cause:** the adapter (`terminalPlayFromZeroDte`, `adapters.ts`) sets `play.pnlPct` straight
from the board's `live_pnl_pct` for a CLOSED row — it is never re-blended once the position closes,
so it still carries whatever the mechanical stop read at the moment of the stop-out. The component
already imports and correctly uses `closedRealizedPct`/`closedCapturePct` for the Trade-outcome
section, but the verdict band and the `managementFor()` call that drives the RATCHET-track marker
were written (or never updated) to read `play.pnlPct` directly — the exact same bug class already
fixed this cycle in `TerminalPremiumPanels.tsx`'s `TradeExcursionGraphic` and `PlayTerminal.tsx`'s
`PnlPanel`/`LegacyPnlPanel`, but a fourth, independent render site that nobody had swept yet.

**Fix:** hoisted the `isClosed`/`realizedPct`/`capturePct` computation above `mgmt`, and introduced
one closed-aware `pnlPct` local — `isClosed ? realizedPct : play.pnlPct` — that now feeds BOTH the
verdict-band headline and the `managementFor(play.exitModel, play.status, pnlPct ?? null)` call
whose `progress` drives the RATCHET-track marker. `markFlash` was left reading the corrected
`pnlPct` too (its own fallback only ever triggers when `play.mark` is null, which the adapter
doesn't do for closed rows, so this is inert for closed rows but consistent). No other call site
changed — `mgmt.progress`/`mgmt.recommendation`/`mgmt.recNote` all flow from the same corrected
value with no further changes needed.

**Verify:**
- `src/features/nighthawk/command-deck/ZeroDteCommandPanel.test.ts` — new describe block: a
  CLOSED, stopped play with `peak: 87.3, pnlPct: -50, exitPnlPct: null` (the same fixture
  `play-card-lifecycle.test.ts` pins `closedRealizedPct` at `6.67` for) now shows `+6.7%` in the
  verdict band, not `-50.0%`; the RATCHET marker lands at `38%` (derived from the blended
  `+6.67%` via the `(p+50)/150` track formula), not `0%` (what the raw `-50%` stop would produce).
  Confirmed RED pre-fix (source reverted to `HEAD` via `git show`, tests failed exactly as
  expected: band `-50.0%`, marker `0%`), GREEN post-fix.
- 7/7 tests pass in this file, 456/456 across the whole `command-deck` test directory, on Node 20;
  `npx tsc --noEmit` clean.
