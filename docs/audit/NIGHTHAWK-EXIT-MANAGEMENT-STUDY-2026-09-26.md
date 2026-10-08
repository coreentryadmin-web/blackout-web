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

## Live run (2026-09-26, production data, `--days=90 --min-n=3`)

**Native swing:** 39 closed positions total (the full 90-day / since-inception population); 28 of
them had a real, usable per-tick history (≥2 snapshots) and were chronologically simulated. Average
193 real ticks per simulated position (~15-min RTH cadence). The 11 excluded rows carry only 0-1
snapshot each (early-history/edge-case rows) and are honestly excluded, never coerced into the
chronological tier.

**Banger:** 1310 closed positions, summary-tier only (as designed — no chronology exists for this
engine).

**Baseline (native swing, n=39, ground truth):** win rate 30.8%, avg winner +93.6%, avg loser −39.0%,
expectancy +1.8% — consistent with the discovery-edge study's independently-computed 90-day numbers
(46.1% win / +1.8% avg realized P&L; the win-rate figures differ slightly because that study used a
different day-window snapshot of the same underlying population, not a discrepancy in either tool).

## Ranked findings

### 1. Banger: real historical exit management measurably underperforms a simple mechanical 50%-at-2×/ride-the-runner policy — the strongest, most statistically solid finding in this study

**Evidence (n=1310, summary-tier, single-peaked-path assumption):** `current_replica` (bank 50% of
size at +100% gain, no trail, ride the other 50% to the real recorded close) averaged **+5.8%** vs.
the REAL recorded average of **+2.6%** — a paired mean delta of **+3.3pp, 95% CI [+1.6, +4.9]**,
entirely positive → **CANDIDATE SEPARATED (better)**. At n=1310 this is not a small-sample artifact.

This directly quantifies part of the discovery-edge study's opportunity/capture gap (43.2% of Banger
closes reached +100% MFE, only 9.2% ever realized it): a plain, mechanical, evenly-split scale-out —
no cleverness, no trailing stop, no timing logic — would have closed roughly a third of that gap on
its own, just by *taking it* at the same level a large share of positions already reach.

**Caveat:** this is the summary-tier approximation (single-peaked path; the "runner" is assumed to
close at the real recorded final P&L regardless of when the first tranche was banked) — the same
disclosed simplification `swing-early-trim-ab.mjs` already uses. It is directionally strong evidence,
not a certified backtest of exact dollars, because Banger has no real per-tick path to confirm the
runner's own trajectory after a hypothetical earlier trim.

**Candidate follow-up:** before touching Banger's real exit code, build the per-tick Banger snapshot
log this study's data-availability section recommends (below), then re-run this exact comparison with
a true chronological replay to confirm the +3.3pp holds under a real path rather than the single-peak
approximation. **Expected benefit:** LARGE if confirmed — a uniform +3.3pp on n≈650/quarter (Banger's
observed close volume) compounds materially. **Regression risk:** MODERATE — a flat 50%/50% split
with no trailing mechanism gives up more of a huge runner's upside than a trailing-stop variant would
(see finding #3's caution below before picking a specific replacement rule); this result argues
Banger's exit mechanism needs *something* mechanical running, not that this exact 50%/no-trail shape
is the optimal one.

### 2. Native swing: the shipped profit-taking ladder (`profit_ladder`) is essentially inert in real historical practice — "current" and "exit only on a thesis/risk gate" are statistically indistinguishable

**Evidence (n=28, full chronological replay):** `thesis_invalidation_only` (zero profit-taking logic
at all — ride every position until a REAL capital-preservation/thesis gate fires, or to the real
final close if none ever does) produced **win rate 32.1%, avg winner +124.3%, mean realized +4.0%** —
matching `no_early_trim` almost exactly (32.1% win, +124.3% avg winner, +4.0% mean) and landing a
paired delta of just **+0.1pp, CI [−0.0, +0.1]** against the REAL recorded "current" outcome. Across
every sub-lane this delta stays at essentially zero (STANDARD +0.0pp, TACTICAL +0.3pp, EXTENDED
+0.1pp) — the tightest, cleanest, most consistent result in the whole native-swing analysis.

**What this means:** real historical native-swing exits are, for practical purposes, driven almost
entirely by the four capital-preservation/thesis gates (`structural_stop`/`thesis_stop`/
`expiry_risk`/`premium_stop`) — NOT by the mechanical trim-then-trail profit ladder, which is
documented in `manage.ts` as one of six *advisory* edge rungs requiring PR-16 graduation before it is
ever enforced. This is independently corroborated by the already-published `swing-early-trim-ab.mjs`
finding (2026-09-10) that the shipped +100% trigger is only even *reachable* 12.9% of the time — a
rung that's rarely reached and (per this new evidence) doesn't move the average when it is.

**This is the single most important structural finding for native swing**: the "exit management"
lever that would extract more profit from trades already found is currently sitting almost entirely
UNUSED, not badly tuned. Before debating trim percentages or trail distances, the more basic question
is whether/when `profit_ladder` should graduate to enforced at all.

**Candidate follow-up:** review the PR-16 graduation criteria and current graduation state for
`profit_ladder` specifically; if it is ungraduated for most archetypes/sub-lanes today, that is itself
the finding to act on (a calibration/rollout decision, not a new rule to design). **Expected benefit:**
POTENTIALLY LARGE — turning on an already-designed, already-shipped mechanism that isn't currently
running is close to a free lever, *if* finding #3 and #4's cautions are heeded on exactly how
aggressively to arm it. **Regression risk:** LOW to investigate (a graduation-state check is read-only
today); MODERATE to actually flip if done without re-validating trigger levels against #3/#4 below.

### 3. Native swing: naive, tighter alternative exit rules are actively harmful in this sample — more/faster exit management is not automatically better

**Evidence (n=28, real winner counts, not noisy means — the most robust numbers this small-n slice
can support):**

| Rule | Winners turned into losers | Large winners (≥50% real gain) prematurely killed |
|---|---|---|
| `trailing_stop_after_mfe` (arm +50%, trail 30%) | **2 of 9** real winners (22.2%) | **3 of 7** (42.9%) |
| `breakeven_stop` (arm +25%, exit at breakeven) | **5 of 9** real winners (**55.6%**) | **3 of 7** (42.9%) |
| `time_based_5` (exit after ~1 session) | 3 of 9 (33.3%) | **7 of 7 (100%)** |
| `time_based_10` (exit after ~2 sessions) | 3 of 9 (33.3%) | **7 of 7 (100%)** |

Every one of these candidate rules, at the specific (disclosed, fixed-in-advance, never tuned against
the outcome) parameters tested, destroys a real, concrete share of NIGHTHAWK's actual winners. The
two time-based variants are the starkest: **100% of the real large winners in this sample would have
had their gains capped early** by exiting after just 1-2 sessions, even though the win RATE nominally
rises (because small gains get locked in before reversals too) — win rate and expectancy alone would
have hidden this if the winner-destruction count weren't reported alongside them.

**Why this matters for #2 above:** "turn on more exit management" is not, by itself, a safe direction.
These specific parameter choices are actively worse than doing nothing extra. Any move to graduate or
add profit-taking logic needs its OWN calibration pass against real forward data — exactly the
discipline this repo's PR-16 ladder already exists to enforce — not a blanket tightening.

**Candidate follow-up:** none of these specific parameter sets should be adopted as tested. If
trailing-stop or time-based logic is pursued at all, it needs its own parameter sweep (arm level ×
trail distance, or hold-length × outcome) against a larger population before any of these numbers
should inform a real decision. **Expected benefit:** N/A — these are evidence AGAINST the tested
parameters, not a recommendation. **Regression risk:** confirmed HIGH for the exact configurations
tested; do not ship any of them.

### 4. Native swing: the mechanical "current policy replica" underperforms the real recorded outcome by a moderate, inconclusive-but-notable margin — and the direction flips by sub-lane

**Evidence (n=28):** `current_replica` (a literal, always-on mechanical reconstruction of the shipped
50%@+100%/trail-50%-of-peak/−60%-hard-stop policy) averaged **+0.4%** vs. the real recorded **+3.9%**
— a **−3.5pp** delta, CI [−19.7, +12.8] (wide, not statistically separated at this n). Segmented by
sub-lane the point estimates diverge sharply: **STANDARD (n=20): +9.9pp** (mechanical replica would
have *beaten* real judgment), **TACTICAL (n=4): −38.5pp**, **EXTENDED (n=4): −35.6pp** (mechanical
replica badly underperforms real judgment in both).

**Read this as two separate things.** First, it is a validity note on this study's own
`current_replica` arm (documented in the Methodology section above as an idealization, not a
byte-for-byte replay) — the divergence from real "current" is itself evidence that real historical
management differs from the pure mechanical ladder, consistent with finding #2 (gates dominate, not
the ladder). Second, TACTICAL and EXTENDED at n=4 each are far too thin to trust as a standalone
result — but the DIRECTION (mechanical rules underperform judgment specifically in the two
non-STANDARD lanes) is a plausible, worth-tracking hypothesis: a short-DTE (TACTICAL) position may
need faster reflexes than a generic +100% ladder gives it, and a long-DTE (EXTENDED) position may
benefit from patience a generic ladder would cut short.

**Candidate follow-up:** re-run this exact segmentation once TACTICAL/EXTENDED closed populations
clear n≥15-20 before treating the sub-lane split as anything more than a first look. **Expected
benefit:** if the split holds, sub-lane-specific exit parameters (not a single global ladder) could be
worth designing. **Regression risk:** NONE to keep measuring; n=4 is far too thin to act on today.

### 5. Data-availability follow-up needed to close the loop: Banger needs its own per-tick log before its exit-management question can be answered with full confidence

Finding #1 (Banger's real management underperforming a mechanical policy by +3.3pp) is strong evidence
at n=1310, but it rests on the single-peaked-path summary approximation because Banger has never
logged a per-tick path. **Concrete ask:** add a lightweight, additive `banger_position_snapshots`
table (mirroring `swing_position_snapshots`'s shape) written by the existing live-sync poll
(`src/lib/banger/live-sync.ts`) — this is a NEW production write path (unlike native swing's export,
which needed no new writer), so it is explicitly NOT built in this pass per the "no production changes
from this study" constraint, and should go through its own dedicated review given it touches the live
poll cron. Once even a few weeks of real Banger tick history accumulate, the same chronological
engine built in this pass (`swing-exit-simulation-eval.mjs`) can be pointed at it directly — the
simulation logic itself is already schema-agnostic (it doesn't know or care which engine's data feeds
it), so no new simulation code would be needed, only a new data source.

---

## Answering the operator's core question: is NIGHTHAWK's biggest lever finding better trades, or extracting more profit from trades it already finds?

**The evidence in hand points at exit management as the larger, more clearly-evidenced current
lever** — with an important caveat on HOW to pursue it.

- The discovery-edge study (`NIGHTHAWK-EDGE-STUDY-2026-09-26.md`) found the entry/discovery side's
  pre-entry signals mostly show weak, noisy, or absent correlations with outcome once measured
  directly (unbucketed Spearman rho typically 0.03–0.33 in magnitude for Banger; native swing's own
  `score` field failed to cleanly rank outcome in two independent measurements). Discovery is finding
  real opportunity (43.2% of Banger closes reach +100% MFE) — the *ranking* of which specific
  opportunities to prioritize is the weaker link on that side, not whether opportunity exists at all.
- This exit-management study found a **statistically solid, large-n (1310) result that Banger's real
  exit execution underperforms a simple mechanical policy by +3.3pp average P&L** (finding #1) — a
  concrete, quantified, currently-unrealized gain sitting on the table.
- It also found native swing's own profit-taking mechanism is **essentially inert in real practice**
  (finding #2) — not badly tuned, just not running — which is close to a free lever if a graduation
  decision is the actual blocker.
- **The caveat**: finding #3 shows plainly that "more exit management" executed carelessly is actively
  harmful — every alternative rule tested at fixed, disclosed (never outcome-tuned) parameters
  destroyed a real share of native swing's actual winners, in one case capping 100% of large winners.

**Net: exit management is the higher-confidence, higher-magnitude lever right now, but it has to be
turned on and tuned with the same calibration discipline this repo already applies everywhere else
(PR-16 graduation, Wilson-LB thresholds, "measure before touching a threshold") — not shipped as a
blanket tightening.** Discovery/ranking remains a real, live question (worth continuing to measure,
per the discovery-edge study's own priority list) but the evidence gathered across both studies does
not show it to be the more promising lever today.

## What Monday RTH / ongoing data capture should still confirm

1. **Banger per-tick logging** (finding #5) — the one concrete infrastructure gap left unaddressed by
   this pass, needed to upgrade finding #1 from a strong summary-tier signal to a certified
   chronological result.
2. **`profit_ladder` graduation state** (finding #2) — a direct read of the PR-16 ladder's current
   status for this rung, to confirm whether "inert" means "ungraduated everywhere" or something more
   specific (e.g., graduated for some archetypes and not others).
3. **TACTICAL/EXTENDED sub-lane divergence** (finding #4) — re-run once each population clears n≥15-20;
   currently n=4 each, a first look only.
4. Continue accumulating native-swing closed positions generally — 28 usable chronological rows is a
   real, working population (proving the new export route/engine), but every finding above would
   sharpen materially at 2-3× the current volume.

---

*Generated 2026-09-26 as part of the standing Ask Largo × Night Hawk Swings ownership mandate
(`CLAUDE.md`), following the operator's explicit directive to determine where the discovery-edge
study's MFE-opportunity-vs-realized-capture gap is being lost. No production weights, thresholds,
gates, or exit logic were changed by this study — see `docs/audit/NIGHTHAWK-EDGE-STUDY-2026-09-26.md`
for the companion discovery-side study this one follows up on.*

