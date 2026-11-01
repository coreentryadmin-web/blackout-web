> **kind:** FINDING

## VEX/DEX/CHARM intraday-shift wall picks compared an unconstrained "now" pick against a spot-side-constrained "earlier" pick — FIXED

| | |
|---|---|
| **Area** | GEX/VEX/DEX/CHARM intraday SHIFT view (`src/lib/providers/polygon-options-gex.ts`'s `computeMetricShift`, shared by `computeGexShift`/`computeVexShift`/`computeDexShift`/`computeCharmShift`) — Thermal matrix + Vector GEX-heatmap shift badges/narration |
| **Severity** | P2 (correctness — misleading shift narration/wall-change numbers on 3 of 4 lenses) |
| **Status** | Fixed |

### Root cause

`computeMetricShift` diffs a "current" per-strike totals snapshot against the earliest
usable "earlier" (baseline) snapshot still in the positioning-history ring, and picks a
call/put wall for each side via `wallsOf(totals, spot)`:

```ts
const curWalls = wallsOf(now, current.spot);
const earWalls = wallsOf(earlier, baselineSnap.spot);
```

`wallsOf`/`wallsFromStrikeTotals` side-constrains its pick (call wall must sit above
`spot`, put wall below it) **only when a `spot` argument is actually supplied** — omit it
and the pick falls back to the pre-#3214 "biggest magnitude anywhere" behavior.

PR #3214 (`fix(thermal): wallsOf() was a fourth unconstrained copy of the wall-pick bug`)
threaded `current.spot` through for the current-side pick and `baselineSnap.spot` through
for the earlier-side pick, with an explicit, deliberate design choice recorded in its own
comment: GEX is the only metric with a real spot-relative resistance/support concept, so
`computeMetricShift`'s `current` parameter made `spot` **optional**, and
`computeVexShift`/`computeDexShift`/`computeCharmShift` (the three other callers) never
supply it — intending their wall picks to "stay unconstrained... exactly as before" on
**both** sides of the diff.

That intent held for the current-side pick (`current.spot` really is `undefined` for
VEX/DEX/CHARM), but not for the earlier-side pick: `baselineSnap.spot`
(`GexHistorySnapshot.spot`) is a **required** field on every ring entry, always a real
number, regardless of which metric is being diffed — the ring stores one `spot` per
snapshot, not one per metric. So `wallsOf(earlier, baselineSnap.spot)` was passed a real,
defined spot value **unconditionally**, for GEX *and* for VEX/DEX/CHARM alike — silently
re-introducing a side constraint on the earlier wall for the three metrics the PR's own
comment says should stay fully unconstrained, while the current wall for those same three
metrics stayed genuinely unconstrained. The result: for VEX/DEX/CHARM, the "current" wall
pick and the "earlier" wall pick in the same diff used two different selection rules for
the identical metric — an unconstrained global-max pick vs. a spot-side-restricted pick —
whenever the true strongest strike at the earlier timestamp happened to sit on the
"wrong" side of that timestamp's spot.

### Evidence

Direct unit-level repro (`computeVexShift`, exported for this purpose): a VEX ring where
strike 90 carries the biggest-magnitude positive vanna at both the baseline (`spot: 100`)
and current (`spot: 105`) snapshots, with strike 90 sitting *below* the baseline's spot
and strike 110 (smaller magnitude, 500 vs 900) sitting *above* it.

RED (pre-fix, `wallsOf(earlier, baselineSnap.spot)` unconditional):
```
not ok 27 - computeVexShift: earlier wall pick stays UNCONSTRAINED ...
  error: earlier pos-vanna wall must be the real global max (90), not 110 ...
  expected: 90
  actual: 110
```
The earlier wall read 110 (spot-constrained) while the current wall correctly read 90
(unconstrained) — a spurious "wall migrated from 110 to 90" would be narrated even though
strike 90 was the dominant pos-vanna strike at **both** timestamps and nothing actually
moved.

GREEN (post-fix, earlier wall gated on the same spot-applicability as the current wall):
```
ok 27 - computeVexShift: earlier wall pick stays UNCONSTRAINED ...
# tests 74
# pass 74
# fail 0
```
Full `polygon-options-gex.test.ts` (74/74) plus the closely-related
`gex-regime-events-concurrency.test.ts`, `wall-side-constraint.test.ts`,
`gex-cross-validation-core.test.ts`, `gex-intraday-adjust-core.test.ts`, and
`admin-gex-health.test.ts` (153/153 combined) all pass after the fix. `tsc --noEmit`
clean. `eslint` clean on both changed files.

### Blast radius

- `computeMetricShift` is the ONE shared implementation behind all four public shift
  builders — `computeGexShift`, `computeVexShift`, `computeDexShift`, `computeCharmShift`
  — so this single fix in the shared function corrects the earlier-wall pick for **all
  three** affected metrics (VEX/DEX/CHARM) at once; GEX's behavior is unchanged (it always
  legitimately supplied a real `current.spot`, so `spotConstrained` is `true` for it and
  both sides stay constrained exactly as #3214 intended).
- Consumers of the affected `wall_changes`/`summary` fields: the Thermal matrix and the
  Vector GEX-heatmap endpoint's VEX/DEX/CHARM lens "shift" badges and narration text
  (`GET /api/market/gex-heatmap`, `GET /api/market/vector/gex-heatmap`, the matrix's
  `vex_shift`/`dex_shift`/`charm_shift` fields) — anywhere a member reads "the pos-vanna
  wall built/melted/slid" for a non-GEX lens could have been shown a wall level and a
  moved_pts/grew_pct delta computed from two incompatible selection rules, both overstating
  and understating real wall migration depending on which side of spot the dominant strike
  happened to sit on at each timestamp. GEX's own shift narration (the most-viewed lens)
  was never affected.
- `delta_by_strike`, `flip_migration`, and the `since_ms`/`baseline_ts` fields are untouched
  — only the two `wall_changes` sub-objects (`call_wall`, `put_wall`) depend on `wallsOf`.

### Fix rationale

Derive the earlier side's spot argument from the SAME applicability test the current side
already uses (`typeof current.spot === "number"`), instead of unconditionally passing
`baselineSnap.spot`:

```ts
const spotConstrained = typeof current.spot === "number";
const curWalls = wallsOf(now, current.spot);
const earWalls = wallsOf(earlier, spotConstrained ? baselineSnap.spot : undefined);
```

This is the minimal change that restores the PR #3214 comment's actual stated intent
(VEX/DEX/CHARM "stay unconstrained... exactly as before" on both sides) without touching
GEX's behavior at all, and without changing `wallsOf`/`wallsFromStrikeTotals` themselves —
the bug was purely in which call sites got a real vs. `undefined` spot, not in the
side-constraint logic itself (which is correct and already covered by its own tests in
`gex-cross-validation-core.test.ts`/`wall-side-constraint.test.ts`). Deliberately did not
add a `spot` field to `GexHistorySnapshot` scoped per metric, or add one to the
`VexShift`/`DexShift`/`CharmShift` current-param shapes — that would be solving a problem
that does not exist (VEX/DEX/CHARM genuinely have no spot-relative resistance/support
concept, per #3214's own reasoning, which this fix preserves rather than relitigates).

Also exported `computeVexShift` (previously module-private), following the same
established precedent as `computeGexEvents` (exported for task #136) — the shared wall-pick
logic lives several calls deep inside the full chain-building pipeline, and exporting the
thin per-metric wrapper lets the regression test exercise it directly with ring/current
fixtures instead of having to construct a full options chain just to reach it.

### Regression test

`src/lib/providers/polygon-options-gex.test.ts` — new test
`"computeVexShift: earlier wall pick stays UNCONSTRAINED (same as current), not silently
side-constrained by the baseline snapshot's spot"`: builds a 2-snapshot VEX ring where the
true dominant pos-vanna strike sits below the baseline snapshot's spot, and asserts the
earlier wall pick matches the current wall pick (both 90, the true global max) with
`moved_pts: 0` — i.e. no spurious migration reported. Confirmed RED pre-fix (`git stash`
toggle on the one-line fix only, test file + export unchanged) and GREEN post-fix.
