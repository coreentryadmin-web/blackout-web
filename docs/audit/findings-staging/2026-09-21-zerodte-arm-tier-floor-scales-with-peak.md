# 0DTE ratchet early-arm/arm ("breakeven") floors were flat regardless of peak size, giving back ~66 real trades' worth of real gains — FIXED

> **kind:** `FINDING`

| | |
|---|---|
| **Status** | FIXED |
| **Component** | `src/lib/zerodte/exit-engine.ts` (`ratchetFloorPct`, `floorReason`), `src/lib/zerodte/strategy-version.ts` (`EXIT_VERSION`, `buildResolvedExitPolicy`'s `trailing_rule`) |
| **Severity** | P2 — live-trading-path, member-facing P&L on the majority of real ratchet-mode winning exits |

### Root cause

`ratchetFloorPct`'s "locked" tier (peak >= +50%) was already fixed on 2026-09-14
(`fix/0dte-ratchet-lock-floor-scales-with-peak`) to scale the floor at 40% of peak instead of a
flat +20%, after a 90-day backtest (n=9) showed every locked-tier exit closing inside a narrow
band regardless of how large the peak got. That fix's own comment already named the mechanism —
"a flat floor giving back a fixed amount past a threshold, regardless of how much bigger the
peak grew" — but only applied the scaling to the ONE tier the 9-case sample happened to cover.
The two tiers below it (`ratchet_early_arm_floor_pct`, flat +5% for peak in [15%,20%);
`ratchet_arm_floor_pct`, flat 0% for peak in [20%,50%)) were left untouched, carrying the exact
same bug shape one and two tiers down.

### Evidence

Pulled the 90-day `/record` window (`entry_context.exit`, the same field the lock-tier fix's own
measurement used) and filtered for `ratchet_early_profit_floor` and `ratchet_breakeven_floor`
exit reasons — the two flat-floor tiers below the lock tier. **70 real exits found** (26 early-arm,
40 breakeven, both far larger samples than the lock tier's original n=9), peaks ranging
15.3%-48.6%.

Counterfactual backtest (same "monotonic decline from peak to close" simplifying assumption the
lock-tier fix disclosed and used — conservative by construction, since a real path that dipped
below a higher floor before recovering would have exited even earlier at that same floor, never
later) at candidate fractions of peak:

```
EARLY-ARM (flat +5% floor, n=26): current mean close 4.91%
  20% of peak: 0/26 win (mean -1.51pp)   25%: 2/26 win   30%: 16/26 win
  35% of peak: 26/26 win (mean +1.04pp)  40%: 26/26 win (mean +1.88pp)

BREAKEVEN (flat 0% floor, n=40): current mean close -0.47% (several real cases closed
  BELOW breakeven entirely — OKLO peak +26.4% -> -12%, SNDK peak +26.1% -> -4.16% — the
  exact "green trade finishes red" this floor exists to prevent, happening anyway)
  20% of peak: 40/40 win (mean +6.27pp)  25%: 40/40 win (+7.72pp)  30%: 40/40 win (+9.17pp)
  35% of peak: 40/40 win (+10.62pp)      40%: 40/40 win (+12.07pp)
```

**40% of peak — the exact same fraction the lock tier already shipped — wins on every single one
of the 66 real cases across both tiers**, the cleanest, largest-sample result of any exit-floor
measurement in this file's history. This also independently confirms the blast radius of the
same-day `trim_scale_dead_zone_floor` mark-honoring fix (PR #5366): 4 of the 70 rows use that
reason and all 4 show the exact understatement pattern that fix corrected (e.g. TSLA peak 24.62%
closed at 9.33% instead of the correct 12.31% — the live bug that PR fixed, caught independently
here from the historical data side).

### Fix

`ratchetFloorPct` now floors at `round2(peakPnlPct * EXIT_RULES.ratchet_lock_floor_fraction)` for
any peak >= `ratchet_early_arm_pnl_pct` (+15%), collapsing what were three independently-flat
constants into one continuous rule — the same fraction the lock tier already used, now applied
from the first arm threshold all the way up. The curve is continuous at every boundary by
construction (0.4 * 15 = 6, 0.4 * 20 = 8, 0.4 * 50 = 20 — each exceeds the corresponding old flat
value, matching the measured win-on-every-case result). `trimScaleFloorPct` delegates to
`ratchetFloorPct` for these same tiers, so trim_scale-mode rows in the early-arm/breakeven range
pick up the identical fix with no separate change.

`floorReason` (which maps a floor breach to its `ratchet_breakeven_floor` /
`ratchet_early_profit_floor` / `ratchet_profit_floor` reason token, used for both the ledger
field and member-facing exit narrative) previously classified by the COMPUTED FLOOR VALUE
(flat 0 / flat 5 / >=20 uniquely identified each tier). That stopped working once all three
tiers compute the same continuous formula — every armed floor is now > 0, so the old
value-based check would have made `ratchet_breakeven_floor` permanently unreachable. Fixed by
reclassifying on the PEAK band instead (the same thresholds that arm each tier in the first
place), preserving the exact same three reason tokens for backward compatibility with existing
ledger rows and dashboards that key off them, even though "breakeven" no longer describes the
floor's literal value.

### Fix rationale

Reused the identical fraction (`ratchet_lock_floor_fraction`, 0.4) already shipped and measured
for the lock tier, rather than introducing a second constant, because the backtest showed it
winning cleanly on BOTH remaining tiers independently — one fraction now covers the whole curve
from +15% up, which is simpler to reason about than three separately-tuned tiers that happen to
share a boundary. Kept the reason-token names and the peak-threshold boundaries (15/20/50%)
unchanged — this is a VALUE change (what floor a peak arms), not a THRESHOLD change (when a
floor arms), matching the narrowest fix that the evidence supports.

### Blast radius

`ratchetFloorPct`'s three call sites in `exit-engine.ts` (ratchet-mode floor arm/breach,
`trimScaleFloorPct`'s delegation for early-arm/breakeven trim_scale rows) all pick up the fix
automatically. `floorReason`'s three call sites updated to pass `peakPnlPct` instead of the
floor value. `buildResolvedExitPolicy`'s `trailing_rule` string (embedded in the frozen
`exit_policy_snapshot` every commit carries) changed shape — `EXIT_VERSION` bumped v5->v6 per
this file's own convention, so a grader replaying an OLD row still uses that row's own frozen
numbers, never silently re-graded under the new curve. `docs/audit/nighthawk-0dte-live-journal.json`
already carries the research trail for this finding (2026-09-21 entries) since it was found via
this session's own OPEN-stage forensic backtest, not a code-review pass.

### Tests

`src/lib/zerodte/exit-engine.test.ts`: 9 pre-existing tests updated from the old flat values
(5/0) to the new scaled values (computed directly from `peak * 0.4`, not re-guessed) —
`ratchetFloorPct`'s own pure-function table test, three `evaluateExitState` arm/breach tests,
two `buildExitContext` floor-honoring tests (including the rounding-boundary regression, redone
with new numbers that reproduce the identical edge case), `resolveExitMark`'s own floor test, a
`trim_scale` shared-floor test, and a stop-vs-floor precedence test (bumped `planStop` so the
stop still sits above the new, higher floor mark, preserving that test's original intent).
`src/lib/zerodte/exit-sync.test.ts`: 2 pre-existing tests (live-sync floor breach + freshest-mark
override) updated the same way. `src/lib/zerodte/exit-policy-snapshot.test.ts`: golden
`config_hash` values recomputed live from the real `buildResolvedExitPolicy` output (not
guessed) for both `ratchet` and `trim_scale` policies.

Full suite: `exit-engine.test.ts` 96/96, `exit-sync.test.ts` + `board.test.ts` +
`exit-policy-snapshot.test.ts` + `strategy-version.test.ts` + `plan.test.ts` combined 298/298,
`zerodte-service.test.ts` + `plan.test.ts` 57/57, `npx tsc --noEmit` clean. Full-repo suite run
in progress at staging time.

---
_Generated by [Claude Code](https://claude.com/claude-code)_
