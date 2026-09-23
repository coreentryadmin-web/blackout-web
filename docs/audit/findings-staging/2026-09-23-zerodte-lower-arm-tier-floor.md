# 0DTE ratchet floor gave ZERO protection to any peak below +15%, giving back real gains at scale — FIXED

> **kind:** `FINDING`

| | |
|---|---|
| **Status** | FIXED |
| **Component** | `src/lib/zerodte/exit-engine.ts` (`EXIT_RULES.ratchet_early_arm_pnl_pct`/`ratchet_early_arm_floor_pct`), `src/lib/zerodte/strategy-version.ts` (`EXIT_VERSION`) |
| **Severity** | P2 — live-trading-path, member-facing P&L on any winning 0DTE trade that peaks below +15% |

### Root cause

Two prior fixes this week (2026-09-14, 2026-09-21) collapsed the ratchet's three floor
tiers into one continuous `peak * 0.4` rule — but only for peaks that had already crossed
the lowest ARM threshold, `ratchet_early_arm_pnl_pct`, which stayed at its original flat
+15%. Below that threshold, `ratchetFloorPct` returned `null` — **no floor at all**,
regardless of how large a real peak was, as long as it stayed under +15%. A trade that
peaked at +14.9% and round-tripped to a full stop-out had zero protection the whole way
down, identical in shape to the two bugs already fixed one and two tiers up, just one
tier further down and never measured until now.

### Evidence

Pulled the 90-day `/record` window and built the population of every play whose peak
P&L sat in `[3%, 15%)` — i.e. every trade whose real peak never crossed the (old) arm
threshold at any point in its life (`peak_pnl_pct` is by construction each play's
all-time maximum, so this population is a FACT about what already happened, not a
hypothetical). Counterfactual backtest (same "monotonic decline from peak to close"
assumption the two prior fixes used and disclosed — conservative by construction, since
a real path that dipped below a higher floor before recovering would have exited even
earlier at that floor, never later):

```
population peak in [3%,15%), n=83: current actual mean close -9.92%

thresh=3%  frac=0.4: n=83, 58/83 win, cf_mean +4.10%  (delta +14.02pp)
thresh=5%  frac=0.4: n=67, 46/67 win, cf_mean +4.56%  (delta +15.85pp)   <- shipped
thresh=8%  frac=0.4: n=38, 29/38 win, cf_mean +5.26%  (delta +21.03pp)
```

Every threshold (3/5/8%) x fraction (0.3/0.4/0.5) combination tested was net-positive —
not a cherry-picked parameter. `thresh=5%/frac=0.4` was chosen: n=67 is the largest
sample among the threshold options that still clears a meaningful bar above the noisiest
low end, and 0.4 is the identical fraction already shipped at the other two tiers (one
continuous formula from +5% up, not a fourth separately-tuned constant).

**Interaction check (flat_theta_bleed):** `evaluateExitState`'s priority order checks
`stopBreached || floorBreached` (step 1) strictly BEFORE `flat_theta_bleed` (step 4,
only reached if steps 1-3 don't fire). The two conditions are structurally disjoint on
the relevant population: floor-breach only ever fires after a real favorable move
(peak >= arm) followed by a pullback, while `flat_theta_bleed` only fires when peak
NEVER left the ±10% band at all. A lower arm tier preempts the timeout exactly when it
should (converting what used to be a lazy "theta bleed" scratch into a controlled
floor-protected exit for any peak >=5%) and never fights it.

**Trim_scale interaction check:** `trimScaleFloorPct` delegates to `ratchetFloorPct` for
every tier outside its own trend-regime dead zone, so it picks up the fix automatically.
The `trimAvailable` guard (`decideTrimScale`, 2026-08-27 dead-zone fix) that suppresses
a floor-EXIT in favor of banking a pending tranche is general (`armed > taken`), not
keyed to any specific numeric threshold — it already correctly handles a floor armed at
the new, lower value exactly the same way it already handled the old +15%/+20% arm
points colliding with a regime's own tranche trigger.

### Fix

`EXIT_RULES.ratchet_early_arm_pnl_pct` lowered from `15` to `5`; its companion
`ratchet_early_arm_floor_pct` (kept only as documentation of the value the fraction
produces at this tier's own threshold) updated from `5` to `2` (`5 * 0.4`).
`ratchetFloorPct`'s formula was already `peak * EXIT_RULES.ratchet_lock_floor_fraction`
for any peak at/above this one constant — no new branch, no new reason token: the
existing `floorReason` already buckets any peak below +20% into
`ratchet_early_profit_floor`, so a peak newly arming in `[5%, 15%)` gets the correct
label for free. `strategy-version.ts`'s `trailing_rule` string interpolates the constant
dynamically (`` `arm@+${EXIT_RULES.ratchet_early_arm_pnl_pct}%->...` ``), so it now reads
"arm@+5%" with no code change there beyond the version bump.

### Fix rationale

The narrowest fix the evidence supports: a single constant's value change (15 -> 5),
identical in shape to the 2026-09-14/09-21 fixes that already established `peak * 0.4`
as the winning formula at every other tier — extending the SAME formula one tier lower
rather than tuning a fourth separate constant. Deliberately did not touch the +20%/+50%
tier boundaries, the reason-token vocabulary, or `trimScaleFloorPct`'s own dead-zone
branch — all three already generalize correctly to the new lower arm point, verified
above rather than assumed.

### Blast radius

`ratchetFloorPct`'s call sites (ratchet-mode floor arm/breach, `trimScaleFloorPct`'s
delegation) all pick up the fix automatically. `buildResolvedExitPolicy`'s
`trailing_rule` string (embedded in the frozen `exit_policy_snapshot` every commit
carries) changed shape — `EXIT_VERSION` bumped v6->v7 per this file's own convention, so
a grader replaying an OLD row still uses that row's own frozen numbers, never silently
re-graded under the new curve. No change to `floorReason`'s reason-token vocabulary, the
`+20%`/`+50%` tier boundaries, or `trimScaleFloorPct`'s trend-regime dead zone.

### Tests

`src/lib/zerodte/exit-engine.test.ts`: added 2 new tests (the +5% arm point itself,
kept the +15% point as a regression test that it's still on the same continuous curve);
updated ~13 pre-existing tests whose fixtures used a peak in the newly-armed `[5%,15%)`
range for an UNRELATED purpose (flat-timeout narrative, thesis-break precedence, plan-
stop-with-no-floor) — each moved its peak fixture below +5% to keep isolating what it
actually tests, rather than accidentally re-testing floor interaction; one dead-zone
"numeric collision" test (`RANGE: ratchet_early_arm_pnl_pct EQUALS the first tranche
trigger`) had its premise broken by the constant's new value (5 != 15, the collision it
documented no longer exists) — rewritten to assert the underlying guard property
(`trimAvailable` is general, not keyed to that specific coincidence) instead of the now-
false equality. `src/lib/platform/zerodte-service.test.ts`: 1 pre-existing test's peak
fixture moved below the new threshold for the same reason. `src/lib/zerodte/exit-sync.test.ts`:
no changes needed (no fixture in the newly-armed range). `src/lib/zerodte/exit-policy-snapshot.test.ts`:
golden `config_hash` values recomputed live from the real `buildResolvedExitPolicy`
output (not guessed) for both `ratchet` and `trim_scale` policies.

Full suite: `exit-engine.test.ts` 97/97, `exit-sync.test.ts` + `board.test.ts` +
`exit-policy-snapshot.test.ts` + `strategy-version.test.ts` combined 266/266,
`zerodte-service.test.ts` + `zerodte-service-marks.test.ts` + `plan.test.ts` 58/58,
`npx tsc --noEmit` clean. All on Node 20.20.2. Full-repo suite run in progress at
staging time, will confirm before merge.

---
_Generated by [Claude Code](https://claude.com/claude-code)_
