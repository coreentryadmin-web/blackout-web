> **kind:** FINDING

## `LegacyPnlPanel` was unreachable dead code — a stale comment claimed Legacy was still tabbed, three cross-references pointed at a function nobody ever renders

| **Status** | FIXED |
|------------|-------|

**Context:** standing Ask Largo × Night Hawk Swings ownership mandate (extends to the whole Night
Hawk product — 0DTE, Swings, Legacy, LEAPS). Investigated as a *candidate* live display bug —
`LegacyPnlPanel` (`PlayTerminal.tsx`) read raw `play.pnlPct`/`play.peak`/`play.trough` instead of
the `legacyPrimaryPnlPct`/`Peak`/`Trough` fallback helpers already used correctly elsewhere in the
same file, the exact shape of two bugs fixed earlier this cycle (`TradeExcursionGraphic`'s "Close"
stat, PR #6619; LEAPS `PnlPanel`'s "Live P&L" headline, PR #6622). Since
`use-legacy-quotes.ts`'s `overlayLegacyQuotes` unconditionally nulls `pnlPct`/`peak`/`trough` for
every Legacy play (a deliberate "FAIL CLOSED" design — no live option mark is sourced for Legacy
yet), the three raw-field reads inside `LegacyPnlPanel` looked permanently dead/wrong: a
"stock P&L from entry" line that could never render, a `TradeExcursionGraphic` MFE/MAE mount gate
that could never pass, and a footer note permanently stuck on its "awaiting quote" branch.

**This is NOT the bug it looked like.** Tracing the actual render tree (`PlayTerminal` function,
same file) showed `LegacyPnlPanel` can never execute for any real play, by construction:
- `legacySinglePanel = play.horizon === "LEGACY"` (line ~248) is **unconditional** — every Legacy
  play takes this branch and renders `LegacyPlayDetailPanel` instead.
- The tab bar / `PnlPanel` branch (where `LegacyPnlPanel` was called) is only reached when
  `!commandSinglePanel && !legacySinglePanel` — i.e. only for `horizon === "LEAPS"` (the only one
  of the four `Horizon` values neither `commandSinglePanel` `(ZERO_DTE | SWING)` nor
  `legacySinglePanel` `(LEGACY)` claims).
- `grep -rn "LegacyPnlPanel"` across the repo found exactly one call site (the now-removed
  `if (play.horizon === "LEGACY") return <LegacyPnlPanel .../>` inside `PnlPanel`), and
  `initialTab` (the only prop that selects a starting tab) is never set to `"pnl"` for a Legacy
  play anywhere in production — only in this file's own test harness.
- `LegacyPlayDetailPanel` (the actually-reachable renderer) already uses `legacyPrimaryPnlPct`/
  `legacyPrimaryPeakPct`/`legacyPrimaryTroughPct` correctly, and its own `TradeExcursionGraphic`
  mount gate (`play.stockPeakPct != null || play.stockTroughPct != null`) is equivalent to the
  "correct" gate for real Legacy data, since `legacyPrimaryPeakPct`/`Troughpct`'s first branch
  (gated on `pnlPct != null`) can never fire when `pnlPct` is always null. **No live member has
  ever seen a defect here.**

The surrounding comments were themselves stale in a way that caused the misdiagnosis: a comment
at the top of `PlayTerminal` claimed "Tabbed horizons (Swing/Legacy/…)" — wrong on both counts
(neither Swing nor Legacy is tabbed; LEAPS is the only horizon that is), and two further comments
elsewhere in the file cited `LegacyPnlPanel`'s rows as the reason some *other* duplicate rows were
removed (2026-08-05 panel declutter) — accurate at the time, now pointing at a function about to
be deleted.

**Fix:** removed `LegacyPnlPanel` entirely, removed the dead `if (horizon === "LEGACY")` branch in
`PnlPanel`, and corrected all three stale comments (the horizon-tabbing claim, and the two
cross-references) to point at `LegacyPlayDetailPanel` instead. This is a dead-code removal, not a
behavior change — there is no before/after difference in anything a real Legacy play ever showed,
so there is no RED→GREEN bug-fix proof to offer (there was no live symptom to be RED about).

**Why remove rather than "fix in place":** the repo's own stated convention — delete confirmed-dead
code rather than patch it — plus a concrete, lived cost: this exact function's raw-field reads were
investigated this cycle as if they were a live bug, following the same template that correctly
caught two real ones earlier the same day. Leaving it in place, "fixed" to use the right helpers,
would have kept a plausible-looking trap for the next audit pass to re-discover and re-diagnose
from scratch.

**Verify:**
- `src/features/nighthawk/command-deck/PlayTerminal.ssr.test.ts` — new case pins the structural
  fact this fix relies on: a Legacy play with `initialTab="pnl"` (pnlPct/peak/trough null, only
  `stockMovePct`/`stockPeakPct`/`stockTroughPct` populated) still renders the single-panel view
  (no `nh-deck-tabs` markup) with its stock-fallback excursion bar intact. This test passes
  identically with and without the removal (confirmed via `git stash` of the source change) —
  which is the expected signature of a true dead-code removal, not a RED→GREEN bug fix.
- 31/31 tests pass in this file on Node 20; `npx tsc --noEmit` clean; full suite run alongside.
