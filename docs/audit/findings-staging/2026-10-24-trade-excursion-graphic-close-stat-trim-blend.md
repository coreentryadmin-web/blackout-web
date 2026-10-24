> **kind:** FINDING

## `TradeExcursionGraphic`'s "Close" stat skipped the trim-scale as-managed blend `closedRealizedPct` already applies in the same panel

| **Status** | FIXED |
|------------|-------|

**Symptom:** standing Ask Largo × Night Hawk Swings ownership mandate (this extends to the whole
Night Hawk product — 0DTE, Swings, Legacy). `TradeExcursionGraphic` (`TerminalPremiumPanels.tsx`)
computed a CLOSED play's "Close" stat as a standalone `play.exitPnlPct ?? play.pnlPct` ternary —
an independent, simpler reimplementation of "realized P&L on a closed position" that skips the
as-managed trim-scale blend. The canonical implementation, `closedRealizedPct()`
(`play-card-lifecycle.ts`), explicitly refuses to trust the raw `play.pnlPct` when
`play.closedReason === "stopped"` — it falls through to `trimScaleBlendedPnlAtStop(play.peak,
PLAN_RULES.stop_pct)` instead, because `pnlPct`/`live_pnl_pct` is often just the raw mechanical
stop pin (e.g. -50%), not the real as-managed blended result once tranches were banked before the
stop.

Both functions render in the SAME component tree for the SAME play object:
`ZeroDteCommandPanel.tsx` computes `realizedPct = closedRealizedPct(play)` and renders it as
"Realized: X%" in the "Trade outcome" section, then a few lines later renders
`TradeExcursionGraphic`, whose "Close" stat used the un-blended ternary — same play, same panel,
two different numbers, whenever `exitPnlPct` is null and `closedReason === "stopped"` with armed
trim tranches.

**Root cause:** the 2026-08-04 fix (PR #1580, `docs/audit/FINDINGS.md`) introduced
`closedRealizedPct`/`trimScaleBlendedPnlAtStop` and wired them into the board/StatsCell/chip and
`ZeroDteCommandPanel.tsx`'s own "Realized" stat, but never touched `TerminalPremiumPanels.tsx`'s
`TradeExcursionGraphic` — a sibling renderer of the identical "closed play's headline P&L"
question that was left on its pre-fix logic. `TerminalPremiumPanels.ssr.test.ts`'s fixture
hardcodes `exitPnlPct: -50` equal to `pnlPct: -50`, so no existing test exercised the
null-`exitPnlPct`/stopped/armed-tranches path — the gap was untested, not just unfixed.

**Fix:** `TradeExcursionGraphic`'s `currentPct` for a closed play now calls
`closedRealizedPct(play)` instead of the standalone ternary — the one canonical function, already
used a few lines above in the same panel. No other field (Peak/Worst/Entry) changed.

**Checked but deliberately left unchanged:** a third occurrence of the same `exitPnlPct ??
pnlPct` shape exists at `src/lib/zerodte/play-timeline.ts:426` (`finalPnl`), inside the full
timeline-reconstruction builder. This is architecturally different, not the same bug: that
function already renders each fired trim tranche as its own separate "Trim" timeline event (with
its own correct banked P&L) a few lines earlier in the same branch, and `finalPnl` there
represents only the terminal/runner leg's own P&L within an already-decomposed sequence of
events — not a single blended headline number competing with another renderer's blended number.
Left untouched rather than widening this fix on an unconfirmed guess.

**Verify:**
- `src/features/nighthawk/command-deck/TerminalPremiumPanels.ssr.test.ts` — new case: a closed,
  `closedReason: "stopped"` play with `peak: 87.3`, `pnlPct: -50`, `exitPnlPct: null` (the exact
  peak value `play-card-lifecycle.test.ts`'s own `closedRealizedPct` trim-scale test uses, which
  resolves to +6.67% → rendered "+6.7%") now shows the blended outcome in the Close stat, not the
  raw -50% stop pin. Confirmed RED pre-fix (git stash of the source change), GREEN post-fix.
- `src/features/nighthawk/command-deck/play-card-lifecycle.test.ts` — both existing
  `closedRealizedPct` cases still pass unchanged.
- 62/62 relevant tests pass on Node 20; `npx tsc --noEmit` clean.
