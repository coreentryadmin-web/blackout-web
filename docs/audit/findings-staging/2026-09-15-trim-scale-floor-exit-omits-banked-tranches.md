> **kind:** FINDING

## Night Hawk 0DTE — trim_scale runner floor-exit narrative never mentions already-banked tranches — FIXED

| **Status** | FIXED in `fix/trim-scale-floor-exit-tranche-note` |
|---|---|

### Root cause

`decideTrimScale`'s floor-exit branch (`src/lib/zerodte/exit-engine.ts`, the `floorBreached`
case) builds its member-facing `detail` sentence from only the runner's own peak/floor/mark —
e.g. *"Mark 4.80 (+20%) is at/below the +21.02% floor armed by a +52.54% peak — the protective
floor exits so the green trade cannot finish red."* That sentence is the ONLY narrative a member
sees for this exit. It never mentions `taken` (how many of the two trim tranches were already
banked at their own, usually better, trigger prices) — even though `taken`/`armed` are already
computed in the same function scope, a few lines above, to decide `trimAvailable`.

Found live 2026-09-15 auditing today's only 0DTE play, SPXW (short, tier B, `exit_policy_at_commit:
"trim_scale"`, closed +21.02%). The board's own `exit_policy.trim_levels` showed BOTH tranches
`fired: true` with real fill premiums (33% at the +20% trigger, premium 14.16; 33% at the +50%
trigger, premium 17.70) — so two-thirds of the position banked profit on the way up before the
final third rode back down to the peak-scaled lock floor (`ratchetFloorPct`'s
`round2(peak * ratchet_lock_floor_fraction)` = `round2(52.54 * 0.4)` = 21.02). The `exit_detail`
string read as if 21.02% were the WHOLE trade's result, with zero indication that 2/3 of the
position had already locked in +20%/+50% earlier. A member (or anyone auditing the board) reading
only that sentence would reasonably, but wrongly, conclude the trade's entire outcome was +21.02%.

### Why it wasn't caught earlier

The exit-engine test suite has thorough coverage of *which* reason/floor fires for a given
peak/tranche-state combination (`trim_scale_first`/`trim_scale_second`/`ratchet_profit_floor`/etc.
— see the existing tests around `exit-engine.test.ts:476-540`), but nothing asserted on the
CONTENT of the floor-exit `detail` string with respect to already-banked tranches specifically —
only the reason code and floor % were checked. The narrative gap is invisible to any test that
only checks `reason`/`floorPnlPct`.

### Blast radius

Single call site: the `floorBreached` branch inside `decideTrimScale` (`exit-engine.ts`). This is
the ONE place that builds the detail string for a trim_scale runner's floor exit (dead-zone floor
exits build a separate detail elsewhere and are unaffected; this fix only touches the
`ratchet_profit_floor`/`ratchet_early_profit_floor`/`ratchet_breakeven_floor` family reached via
this branch). No other consumer duplicates this string — it flows straight through to the ledger's
`exit_detail` field and the board/Largo-facing narrative.

**Not touched, deliberately**: this fix is narrative-only. It does not change `floorPnlPct`,
`reason`, `pnl_pct`, or any P&L math — those are all governed by a separate, larger question (does
`managed_pnl_pct`/`timeline_tranches` need to reflect a real blended P&L across banked tranches,
which requires the offline WS-10/WS-11 executable reconstruction in `plan.ts` — `entry_context.
executable.tranches` was `null` for this row, so that reconstruction hadn't run for it). That is a
separate, larger, P&L-reconciliation-adjacent question reported separately on PR #4076 for someone
with fuller context on `plan.ts`'s reconstruction cadence to confirm — not fixed here, deliberately,
since it touches real P&L figures rather than just the accompanying prose.

### Fix rationale

Append one sentence to the existing `detail` string, using `taken` and `thresholds.length` (both
already computed in scope, zero new inputs) — only when `taken > 0`: *"This is the runner only —
N/2 tranches (33% each) already banked on the way up."* When no tranche has armed yet (`taken ===
0`), the sentence is omitted entirely — never claims a banked tranche that didn't happen. This is
the minimal, lowest-risk fix: pure string formatting from data already in scope, no new gate, no
change to any exit decision or P&L number.

### Evidence

RED→GREEN via `git stash`: with `exit-engine.ts` stashed (test file only), the new regression test
fails with the exact live SPXW shape (`peakPremium: 6.1016` / `52.54%` peak, `trimsTaken: 2`,
`currentMark: 4.8` / floor breach) — `detail` reads *"...cannot finish red."* with no tranche
mention. With the fix restored, the same input passes, and a second test (peak that never armed a
tranche, `trimsTaken: 0`) confirms the sentence is correctly omitted when there's nothing to
report. Full suite: 14313 pass / 0 fail / 3 skipped (pre-existing skips, unrelated) on Node 20.
`tsc --noEmit` clean.

### Evidence — the live row this was found on

```
SPXW short, tier B, closed 2026-09-15T14:25:14.358Z, occ O:SPXW260915P07595000
exit_policy.trim_levels: [{trigger_pct:20, fraction:0.33, premium:14.16, fired:true},
                          {trigger_pct:50, fraction:0.33, premium:17.70, fired:true}]
exit_detail (before): "Mark 14.15 (+19.92%) is at/below the +21.02% floor armed by a +52.54%
  peak — the protective floor exits so the green trade cannot finish red."
exit_detail (after, for an equivalent future row): "...cannot finish red. This is the runner
  only — 2/2 tranches (33% each) already banked on the way up."
```
