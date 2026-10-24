> **kind:** FINDING

## LEAPS `PnlPanel`'s "Live P&L" headline ignored a closed play's recorded `exitPnlPct`, showing a stale mechanical mid instead

| **Status** | FIXED |
|------------|-------|

**Symptom:** standing Ask Largo × Night Hawk Swings ownership mandate (extends to the whole Night
Hawk product — 0DTE, Swings, Legacy, LEAPS). `PnlPanel` (`PlayTerminal.tsx`), the LEAPS-horizon
tabbed detail panel's "PnL" tab, computed its "Live P&L" headline number as a bare `play.pnlPct`
read, with no awareness of whether the play was closed or whether a real, recorded `exitPnlPct`
existed. `isZeroDtePremiumTerminal` (`terminal-display.ts`) is true only for `ZERO_DTE`/`SWING`
(both of which divert to `ZeroDteCommandPanel`'s own `closedRealizedPct`-backed "Realized" stat
instead), and `LEGACY` returns early inside `PnlPanel` via `LegacyPnlPanel` — so LEAPS is the
*only* horizon that ever reaches this exact branch. For a closed LEAPS play whose last live mid
(`pnlPct`) differed from its actual recorded exit fill (`exitPnlPct`) — e.g. a stale -50% mid vs
a real +42% exit — the headline showed the stale mechanical number instead of the real outcome.

**Root cause:** same class of bug as the sibling `TradeExcursionGraphic` fix (same cycle,
`TerminalPremiumPanels.tsx`) — a renderer that never adopted the "prefer the recorded exit stamp"
discipline other renderers of the same underlying P&L concept already use. Unlike that sibling
fix, this one is **deliberately narrower in scope**: `closedRealizedPct()`
(`play-card-lifecycle.ts`) isn't reused wholesale here, because its `closedReason === "stopped"`
fallback blends via `trimScaleBlendedPnlAtStop(peak, PLAN_RULES.stop_pct)` — a 0DTE-specific
-50% stop convention (`src/lib/zerodte/plan.ts`) that is unconfirmed for LEAPS's own (likely much
wider, multi-session) stop/exit mechanics. Even SWING's own `SWING_SCALE_OUT_POLICY`
(`exit-policy.ts`) uses a different -60% hard stop than `PLAN_RULES.stop_pct`'s -50% — a
pre-existing mismatch already baked into `closedRealizedPct` for a horizon it IS used for,
flagged here but deliberately left alone as out of scope for this fix. Applying that same
unvalidated blend to LEAPS risked trading one honest-but-stale number for a confidently wrong
blended one.

**Fix:** `PnlPanel`'s `live` local now reads `play.status === "CLOSED" ? (play.exitPnlPct ??
play.pnlPct) : play.pnlPct` — only the universally-safe part of the pattern (prefer the recorded
exit stamp once genuinely closed; otherwise show the live mid exactly as before). The
trim-scale-blend question for a `closedReason: "stopped"` LEAPS row with no `exitPnlPct` is left
open, not silently assumed correct.

**Verify:**
- `src/features/nighthawk/command-deck/PlayTerminal.ssr.test.ts` — new cases: a CLOSED LEAPS
  play with `pnlPct: -50, exitPnlPct: 42` now shows `+42.0%`, not the stale `-50.0%`; a sibling
  OPEN LEAPS play (`exitPnlPct: null`) still shows its live mid unchanged, confirming the fix is
  closed-only. Confirmed RED pre-fix (git stash of the source change), GREEN post-fix.
- 30/30 tests pass on Node 20; `npx tsc --noEmit` clean.
