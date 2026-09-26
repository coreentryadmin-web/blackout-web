# NIGHTHAWK exit-management study — 2026-09-26

**Status: research/measurement only. No production weights, thresholds, gates, or exit logic were
changed as part of this study.** This is a placeholder skeleton, populated with methodology and
data-availability sections while the underlying route (PR #5512) deploys; the ranked findings and
real numbers land once the live run completes.

## Why this study

The prior discovery-edge study (`docs/audit/NIGHTHAWK-EDGE-STUDY-2026-09-26.md`) found that 43.2%
of closed Banger positions reached a 100%+ premium gain at some point (the MFE opportunity existed),
but only 9.2% ever realized a 100%+ gain (the capture rate). The operator's follow-up directive:
determine EXACTLY where that gap is being lost — is it entry selection (finding better trades) or
exit management (extracting more profit from trades already found)?

## Data availability (confirmed this pass, before any simulation was built)

- **Native swing**: `swing_position_snapshots` has been written every ~15 minutes during RTH since
  the engine's real-money go-live (2026-07-24 — the same day the writer shipped), so there is no
  tail of real closed positions that predates snapshotting. There was, however, **no export route**
  before this study — `fetchSwingSnapshots` (the per-position ordered-series accessor) existed with
  zero callers outside its own cron writer and tests. Built one: `GET
  /api/admin/swing/closed-position-snapshots` (PR #5512, merged).
- **Banger**: no per-tick history exists or has ever existed. `peak_premium`/`trough_premium` are
  pure update-in-place running max/min columns (`GREATEST`/`LEAST` latching) — every intermediate
  path value is overwritten and lost. A true chronological replay of alternative exit rules is
  therefore **only possible for native swing**; Banger gets the narrower summary-tier comparison this
  repo's existing `swing-early-trim-ab.mjs` methodology already established (entry/peak/exit values
  only, under a single-peaked-path assumption).

## Methodology

**Native swing — full chronological replay.** For every closed position (leg) with a real per-tick
history, 9 named exit rules are simulated by walking the REAL observed `option_mark` path tick by
tick:

1. `no_early_trim` — ride 100% of size to the real gate/close, no partial banking at all.
2. `current_replica` — mechanical reconstruction of the shipped policy (50% at +100% gain, trail the
   runner at 50% of its own peak-since-armed, −60% hard stop before any tranche is taken).
3. `trim_30_50_runner` — 30% of size at +50% gain, 50% of size at +100% gain, 20% runner (same
   trail/hard-stop mechanics as #2).
4. `trim_50_runner_no_trail` — 50% at +100% gain, 50% runner with NO trailing stop (hard stop only)
   — isolates the value of the trailing mechanism specifically.
5. `trailing_stop_after_mfe` — no upfront trim; arm a trailing stop once gain first crosses +50%,
   exit on a 30% retrace from the peak reached since arming.
6. `breakeven_stop` — no upfront trim; once gain first crosses +25%, move the stop to breakeven
   (entry) and exit if price ever retraces back to entry afterward.
7. `time_based_5` / `time_based_10` — exit at a fixed hold length (5 or 10 real ticks, ~1-2 RTH
   sessions) regardless of price, unless a gate fires first.
8. `thesis_invalidation_only` — zero profit-taking mechanics; exit ONLY when a real capital-
   preservation/thesis gate fires; otherwise ride to the real final close.

**The "current" arm is never simulated — it is the real recorded outcome** (`exitPnlPct`,
`closedReason` already on the closed-position record), so that comparison arm carries zero
simulation risk. Every candidate rule is compared against it as a PAIRED delta (same position,
both arms), not an independent-sample comparison.

**Look-ahead discipline.** Every rule decides its action at tick *i* using only `ticks[0..i]` — the
mark/gate signal observed at or before that tick. The one shared mechanism across every candidate
rule is a real "gate floor": the first tick (if any) where `event_json.gating === true` in the
actual historical snapshot stream — production's own already-computed, tick-stamped capital-
preservation/thesis-invalidation verdict (`manage.ts`'s `structural_stop`/`thesis_stop`/
`expiry_risk`/`premium_stop`, documented as "GATE (enforced:true always)"). A candidate rule at tick
*i* does not know a gate will fire three ticks later — it only ever respects one that has ALREADY
fired. This is how "thesis/invalidation exits" is tested without reimplementing swing's qualitative
thesis-break logic from scratch (already established as unreconstructable offline without
fabrication) — the real system already computed it, tick by tick, and logged it.

**A necessary and important caveat on `current_replica` specifically**: swing's real
`profit_ladder` rung (the mechanical trim-then-trail logic) is one of six *advisory* edge rungs that
require graduation (the PR-16 calibration ladder) before being enforced in live production — unlike
the four capital-preservation GATES, which are always enforced. `current_replica` is therefore a
**mechanical idealization of the shipped policy**, useful as an internal, apples-to-apples baseline
against which every OTHER candidate rule is equally idealized — not necessarily byte-identical to
what any specific historical position actually experienced if `profit_ladder` wasn't graduated for
it at the time. The comparison of `current_replica` against the REAL ground-truth `current` arm is
itself reported as a first-class finding below: a small, tight delta is evidence the idealization
tracks reality closely; a large one is a genuine, separate finding about calibration/graduation gaps.

**Banger — summary-tier only.** Only `no_early_trim`, `current_replica` (as a flat trim, no trail
modeled — the same simplification `swing-early-trim-ab.mjs` already discloses), and
`trim_30_50_runner` are computable from entry/peak/exit SUMMARY values. `trailing_stop_after_mfe`,
`breakeven_stop`, both time-based variants, and `thesis_invalidation_only` are reported as N/A for
Banger — not guessed — because they are timing-dependent and no chronology exists to test them
against.

**Segmentation.** Native swing results are segmented by direction (LONG/SHORT), archetype, sub-lane,
score (quantile-bucketed), and DTE-at-entry (quantile-bucketed), wherever the bucket clears a minimum
n. Banger has no archetype/sub-lane/score classification (a screener, not archetype-classified) and
is LONG-only by deliberate design (already confirmed this session) — its segmentation is
correspondingly narrower.

**Metrics reported per rule**: win rate, average winner, average loser, expectancy, mean realized
P&L, mean paired delta vs. current with a 95%-normal-approx CI (same discipline as
`swing-early-trim-ab.mjs`), the rate at which the rule turned a real winner into a loser, and the
rate at which it prematurely killed a large real winner (current ≥ 50% realized, candidate < half of
that).

## Tooling built this pass

- `src/app/api/admin/swing/closed-position-snapshots/route.ts` — the new admin export route.
- `scripts/audit/lib/swing-exit-simulation-eval.mjs` (+16 unit tests) — the pure simulation engine.
- `scripts/audit/swing-exit-management-study.mjs` — the live orchestration script that produced the
  results below.

---

## [PENDING — populated once the live run completes against deployed production data]

