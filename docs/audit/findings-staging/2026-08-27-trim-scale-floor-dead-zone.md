> **kind:** FINDING

## trim_scale's shared breakeven floor preempted its own trim tranche — SLS/TSM round-tripped +22% peaks to flat — FIXED

| **Status** | FIXED in `fix/trim-scale-floor-dead-zone` |
| **Severity** | P1 — real trade P&L, live 0DTE exit engine |
| **Surface** | `src/lib/zerodte/exit-engine.ts` `decideTrimScale` (Night Hawk 0DTE, `trim_scale` exit mode — the A/B-tier default) |

### Symptom

Live 2026-08-27 session: 11 committed plays, all under `trim_scale` (`entry_context.exit_policy_at_commit`). SLS peaked at **+22.09%** P&L, TSM peaked at **+20.59%** — both round-tripped their **entire** position all the way back to exactly **0% (breakeven)**, exiting via reason `ratchet_breakeven_floor`. Neither ever banked a single trim tranche, defeating the whole point of `trim_scale` (E5: "don't scratch a momentum runner at breakeven").

### Root cause

`decideTrimScale`'s step 1 ("protective: plan stop OR the shared early/breakeven ratchet floor") reuses `ratchetFloorPct` — the SAME fixed-threshold table the legacy, C-tier-only `ratchet` mode uses (`ratchet_arm_pnl_pct: 20` arms a **breakeven** floor once peak ≥ 20%). `trim_scale`'s own first tranche trigger is a **separate, regime-conditioned** table (`TRIM_SCALE_RULES.tranches_by_regime`): `neutral: [20, 50]`, `range: [15, 40]`, `trend: [40, 80]`.

Two independent threshold tables, checked in a fixed order, with **coincident or crossing** values:
- **neutral**: `ratchet_arm_pnl_pct` (20) **exactly equals** `tranches_by_regime.neutral[0]` (20).
- **range**: `ratchet_early_arm_pnl_pct` (15) **exactly equals** `tranches_by_regime.range[0]` (15).
- **trend**: `ratchet_arm_pnl_pct` (20) sits **below** `tranches_by_regime.trend[0]` (40) — the widest gap, but structurally different (see "what this does NOT fix" below).

Because the floor check (step 1) ran **before** the trim-tranche check (step 3) in code, whenever a peak was high enough to arm BOTH tables on the same tick, the floor always won and dumped the **whole** position at breakeven, even though the peak had already earned the first trim tranche. This is not a poll-cadence artifact that could be dismissed as "just poll faster" — the peak is a **latched** value tracked between ticks specifically so a retrace can't erase it, so the very first tick that observes both "peak crossed the tranche trigger" and "mark has since retraced to the floor" will always take this path, at any polling interval.

### Evidence

- Live 2026-08-27: SLS (peak 22.09%) and TSM (peak 20.59%) both closed flat via `ratchet_breakeven_floor`, confirmed via each row's `entry_context.exit_policy_at_commit: "trim_scale"` and 0 tranches banked.
- Reproduced deterministically in `src/lib/zerodte/exit-engine.test.ts`: `evaluateExitState({ exitMode: "trim_scale", peakPremium: 4.8836 /* +22.09% */, currentMark: 4.0 /* 0% */, trimsTaken: 0 })` returned `{ action: "EXIT", reason: "ratchet_breakeven_floor" }` before the fix; now returns `{ action: "TRIM", reason: "trim_scale_first" }`.
- `TRIM_SCALE_RULES.tranches_by_regime.neutral[0] === EXIT_RULES.ratchet_arm_pnl_pct` (both 20) and `.range[0] === EXIT_RULES.ratchet_early_arm_pnl_pct` (both 15) are now asserted directly in the test suite so this coincidence can't silently drift back into a bug undetected.

### Blast radius

Single call site: `decideTrimScale` is the only place `ratchetFloorPct` is invoked from the `trim_scale` path (`evaluateExitState` only calls it directly for `ratchet` mode, at a different line, which is untouched). No other consumer duplicates this precedence logic — `exit-sync.ts` and `zerodte-service.ts` both call `evaluateExitState`/`trimTranchesArmed`/`ratchetFloorPct` as pure functions and inherit the fix automatically; neither reimplements the ordering.

### Fix

`decideTrimScale` now computes `armed = trimTranchesArmed(peakPnlPct, regime)` **before** the floor check, and suppresses the floor's EXIT action (`trimAvailable = armed > taken`) whenever the peak has armed a tranche the caller hasn't banked yet — the trim fires instead (step 3, unchanged code, now guaranteed to run when applicable). Once the tranche is banked, the caller's next tick reports `trimmed: true`, which raises the shared floor to the **+50% runner floor** for the remainder — strictly better protection than what riding the breakeven floor to the finish would have given the whole position.

**Rejected alternative**: deleting the shared floor entirely. It is not redundant — a peak that has genuinely **not** armed any tranche yet (e.g. `trend` regime at a 20-39% peak, where the first tranche needs +40%) still needs the breakeven/early-arm safety net; that path is untouched and still fires normally (asserted by a new regression test).

**What this does NOT fix (documented, not a regression)**: `trend` regime's gap between its breakeven arm (peak +20%) and its own first tranche (peak +40%) is a genuinely **unarmed** window — no tranche exists to bank there, so this precedence fix has nothing to bypass to, and a `trend` peak sitting at 20-39% that retraces to breakeven still exits via the shared floor exactly as before. That is a calibration question (whether `trend`'s own trigger should sit closer to the ratchet arm), not an ordering bug, and is out of scope here — flagged for whoever next tunes the regime thresholds.

**Ratchet mode is untouched**: the fix is entirely inside `decideTrimScale`; `evaluateExitState`'s `mode === "ratchet"` branch calls `ratchetFloorPct` directly at a different call site, never reached by this change. All pre-existing `ratchet`-mode tests pass unmodified.

### Tests

`src/lib/zerodte/exit-engine.test.ts`: 7 new tests — the exact live SLS/TSM shape (peak +22.09%/+20.59% round-tripping to 0%, now banks instead of dumping), the "already taken" case proving the bypass is one-tick-only (not an infinite suppression), the negative case proving a genuinely-unarmed peak still floors normally, and one regression test per regime (`neutral`/`range`/`trend`) pinning the exact numeric relationship between `EXIT_RULES` and `TRIM_SCALE_RULES.tranches_by_regime` so this class of bug can't return silently if either constant is tuned independently in the future.

### Verification

`node --import tsx --experimental-test-module-mocks --test src/lib/zerodte/exit-engine.test.ts src/lib/zerodte/scan.test.ts src/lib/zerodte/board.test.ts src/lib/platform/zerodte-service.test.ts src/lib/platform/zerodte-service-marks.test.ts src/lib/zerodte/exit-sync.test.ts` on Node 20.20.2 — **262/262 pass** (76 exit-engine incl. 7 new, 125 scan+board, 36 zerodte-service/exit-sync/marks + zero-diff on ratchet-mode assertions).
