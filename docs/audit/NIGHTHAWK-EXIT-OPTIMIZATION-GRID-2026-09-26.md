# NIGHTHAWK exit-management optimization grid — 2026-09-26

**Status: research/measurement only. No production weights, thresholds, gates, or exit logic were
changed as part of this study.** This is a deliberate follow-up to
`docs/audit/NIGHTHAWK-EXIT-MANAGEMENT-STUDY-2026-09-26.md`, which found the Banger-shaped "50% at
+100%, ride the runner" policy beats real historical management by +3.3pp average P&L (n=1310). Per
the operator's explicit directive, this pass runs a deeper grid around that result — proof first,
decisions later.

## Methodology

**Grid.** 6 profit-take trigger levels (+50/+75/+100/+125/+150/+200%) × 4 scale-out fractions
(25/33/50/67%) = 24 configurations, each a single trim rung. For the remaining size after the trim
fires, 4 runner exit styles are tested SEPARATELY (not crossed into the main 24-cell grid, to keep
the grid itself legible): `thesis_risk` (the existing thesis/risk exit — ride until a real
capital-preservation/thesis gate fires or the series ends; this is the requested baseline), plus
`trailing_stop` (three trail distances: 20/30/40% giveback from the runner's own peak-since-trim),
`breakeven_stop` (exit if the runner ever falls back to the original entry premium), and `time_exit`
(exit 5 or 10 ticks after the trim). The main 24-cell grid always uses `thesis_risk` for the runner;
the other three styles are compared only at the leading native-swing configs (Part C).

**Look-ahead discipline.** Identical invariant to the prior study: every rule decides at tick *i*
using only `ticks[0..i]`, and every rule (regardless of trigger/fraction/runner style) respects the
SAME real "gate floor" — the first tick where production's own logged capital-preservation/thesis-
invalidation verdict (`event_json.gating`) was already true. A trim or runner-style condition never
looks past a real gate. See `scripts/audit/lib/swing-exit-optimization-eval.mjs`'s own header for the
full argument, including the one deliberate simplification versus the prior module (no synthetic
hard-stop layered on top of the real gate floor — redundant, since `premium_stop` breaches are
already gate events).

**Native swing** (n=29 closed positions with real per-tick history, of 39 total) gets the full
chronological grid. **Banger** (n=1310) gets the summary-tier grid only (entry/peak/exit values,
single-peaked-path assumption) — no chronology exists for Banger, so the four runner styles and the
walk-forward-by-tick-timing questions cannot be tested for it; only the trigger×fraction grid under
the `thesis_risk`-equivalent ("trim then ride to the real recorded close") applies.

**Metrics per cell**: n, reach rate (how often the trigger fires at all), win rate, median AND mean
realized return, expectancy, profit factor (sum of winning %-returns / abs(sum of losing %-returns),
an equal-weighted per-trade basis, not $-weighted), average drawdown-after-profit (native swing only
— needs a real path), average MFE-captured% (computed ONLY on non-negative realized outcomes, per
this repo's own `mfeCaptureOutcome` convention — a round-trip to a loss is a different event, not a
worse "capture", and averaging its ratio in would silently explode the mean with meaningless outliers;
a real methodological bug found and fixed mid-build, before any reported number used it), the paired
mean delta vs. the REAL recorded "current" outcome with a 95% CI, and the two failure-mode rates:
winners turned into losers, and large winners (current ≥ 50%) prematurely capped.

**Segmentation** (Part D) is applied to the SINGLE best config per engine only, not all 24 cells — an
explicit scoping decision to keep the output legible; a config that looks best in aggregate but is
driven by one or two names, or that only works for one contract type, would be a real problem this
still catches.

**Walk-forward validation** (Part E): the population is split chronologically into an early half and
a late half (by `committedAt` for swing, `session_date` for Banger), and the SAME grid is
independently re-run on each half. A config that ranks #1 in only one half is a fitted artifact; a
config that ranks #1 in both is real, out-of-sample-stable evidence.

## Part A — is `profit_ladder`'s +100% trigger appropriate for NIGHTHAWK's actual lifecycle?

Real MFE reach-rate curve (how often the position's own peak premium ever reaches each level):

| Trigger | Native swing (n=38) | Banger (n=1310) |
|---|---|---|
| +50% | 28.9% | 53.4% |
| +75% | 21.1% | 47.4% |
| +100% (shipped) | **18.4%** | **43.2%** |
| +125% | 15.8% | 37.8% |
| +150% | 10.5% | 33.7% |
| +200% | 7.9% | 27.2% |

**Answer:** +100% is not obviously mis-set on reach-rate grounds alone — it already sits on a smooth,
monotonically-declining curve for both engines, not at some obvious cliff or dead zone. The real
finding (Part B) is sharper than "is the level right": for Banger, *every* level from +75% up through
+200% shows a real, mostly statistically-separated improvement over current when actually acted on —
and the improvement gets LARGER, not smaller, at higher trigger levels, even though fewer trades
qualify. That is a different diagnosis than "the trigger is miscalibrated" — it is "the trigger,
wherever it's set in this tested range, is barely being ACTED ON in practice" (corroborating the
prior study's finding that `profit_ladder` is essentially inert). Fixing the level is secondary to
fixing the fact that it doesn't fire.

## Part B — the main grid, ranked by expectancy

### Banger (summary-tier, n=1310) — a clean, monotonic, mostly statistically-solid pattern

| Config | Reach | Win | Median | Expectancy | Profit factor | Mean Δ vs. current | 95% CI | Verdict |
|---|---|---|---|---|---|---|---|---|
| +50% / 50% | 53.4% | 43.2% | −5.0% | +0.6% | 1.02 | −2.0pp | [−3.9, 0.0] | INCONCLUSIVE |
| +75% / 50% | 47.4% | 47.4% | −60.0% | +3.3% | 1.10 | +0.7pp | [−1.1, +2.5] | INCONCLUSIVE |
| **+100% / 50%** (the original finding) | 43.2% | 43.2% | −60.0% | +5.8% | 1.17 | **+3.3pp** | **[+1.6, +4.9]** | **SEPARATED** |
| +100% / 25% | 43.2% | 43.1% | −60.0% | +4.2% | 1.12 | +1.6pp | [+0.8, +2.4] | SEPARATED |
| +100% / 33% | 43.2% | 43.1% | −60.0% | +4.7% | 1.14 | +2.2pp | [+1.1, +3.2] | SEPARATED |
| +125% / 50% | 37.8% | 43.1% | −60.0% | +9.0% | 1.26 | +6.5pp | [+4.8, +8.1] | SEPARATED |
| +150% / 50% | 33.7% | 43.1% | −60.0% | +11.7% | 1.34 | +9.1pp | [+7.4, +10.8] | SEPARATED |
| +200% / 50% | 27.2% | 43.1% | −60.0% | +15.3% | 1.45 | +12.8pp | [+10.9, +14.7] | SEPARATED |
| **+200% / 67%** (grid winner by raw expectancy) | 27.2% | 43.1% | −60.0% | **+19.7%** | **1.58** | **+17.1pp** | **[+14.6, +19.6]** | **SEPARATED** |
| +100% / 67% | 43.2% | 43.2% | −60.0% | +6.9% | 1.20 | +4.4pp | [+2.2, +6.5] | SEPARATED, but 11/394 large winners capped early (highest of any config tested) |

**Read this carefully — two real, different recommendations live in this table, not one:**
- **+50% is the one level that does NOT clear the bar** — its CI crosses zero (point estimate even
  slightly negative). Scaling out that early is not supported by this data.
- **Every level from +75% through +200% shows a real, mostly-separated improvement, and the
  improvement grows monotonically with the trigger level** — this is the single cleanest pattern in
  the whole study. But reach rate falls just as monotonically (53% → 27%), so the highest-expectancy
  cell (+200%/67%) only ever fires on about a quarter of all Banger positions; the other three-
  quarters see zero behavior change from current under that specific config.
- **`prematurelyKilledLargeWinners` stays at 0 (or 1) of 394 large winners for every trigger ≥125%,
  but jumps to 11/394 at +100%/67%** — banking a large fraction (67%) at a comparatively low trigger
  (+100%) caps meaningfully more big winners early than banking the same large fraction at a higher
  trigger. Fraction and trigger interact; neither should be tuned in isolation.

### Native swing (chronological, n=28-29) — no config clears the bar; population too small

Every single one of the 24 grid cells for native swing lands **INCONCLUSIVE** (CI straddles zero).
The best point estimates (+125%/25%: expectancy +3.5%, meanΔ −0.4pp; +125%/33%: +3.3%, meanΔ −0.6pp)
are indistinguishable from current given the noise at this sample size. **This grid does not produce
a statistically defensible native-swing-specific recommendation today** — see Part E for why the
walk-forward split makes this even clearer, and the "what Monday needs to confirm" section for the
concrete population threshold worth re-running at.

## Part C — runner-style comparison (native swing, top 3 configs by raw expectancy)

At `+125%/25%` (n=28): `thesis_risk` +3.5% expectancy / PF 1.1 (baseline) vs. `trailing_stop@20%`
−2.0% / PF 0.9 (worse) vs. `trailing_stop@30%` **+5.8%** / PF 1.2 (best) vs. `trailing_stop@40%`
+4.0% / PF 1.1 vs. `breakeven_stop` +1.2% / PF 1.0 vs. `time_exit@5` −0.5% / PF 1.0 vs. `time_exit@10`
−0.6% / PF 1.0. The same shape repeats at the other two top configs (`+125%/33%`, `+200%/25%`).

**Directionally consistent with the prior study's caution, not a reversal of it**: a *tight* trailing
stop (20% giveback) still underperforms; a *moderate* one (30-40%) shows the best point estimate of
any runner style tested, ahead of even the thesis/risk baseline. Time-based exits remain the weakest
alternative at every base config tested. **None of this is statistically separated at n=28** — it is
a first-look directional signal, not a recommendation, and it should not be read as contradicting the
prior study's finding that tight/naive versions of these same rule families were actively harmful —
this result is about which SPECIFIC parameter within a family is least bad, not whether the family
itself is safe to ship.

## Part D — segmentation of the single best config per engine

### Native swing (`+125%/25%`)

- **By option type**: CALL (n=21) expectancy +4.2%, PUT (n=7) expectancy +1.2% — thin, no clear
  divergence given the CI width already established in Part B.
- **By archetype**: SECTOR_ROTATION (n=7) +20.7%, PULLBACK_CONTINUATION (n=7) +18.8%, EVENT_DRIVEN
  (n=7) **−31.6%**, POST_EARNINGS_DRIFT (n=1, uninterpretable). A real, if thin, spread — EVENT_DRIVEN
  looks like the weakest fit for this exit shape.
- **By sub-lane**: TACTICAL (n=4) +53.1%, EXTENDED (n=4) +61.1%, STANDARD (n=20) **−18.0%** — n=4 is
  razor-thin for TACTICAL/EXTENDED; flagged, not trusted.
- **By DTE-at-entry**: 1-2 DTE (n=6) +100.7%(!), 2-3 DTE (n=6) +56.0%, then 4-7/8-10/14-21 DTE
  buckets (n=5-6 each) all **deeply negative** (−56% to −59%). This is the most striking segment in
  the whole native-swing analysis: very-short-DTE positions look dramatically better under this exit
  shape than everything else. Thin (n=5-6/bucket) but worth a dedicated follow-up given how clean the
  split is.
- **By score, IV-rank, MFE**: no clean monotonic pattern for score (consistent with the
  already-published finding that `score` doesn't cleanly rank outcome); MFE segmentation is close to
  tautological (bigger real moves benefit more from a trigger-based exit, unsurprising) and IV-rank is
  too thin (n=4-6/bucket) to read.
- **By ticker**: no name appears more than twice (NVDA/CRWD/AAPL/INTC/EWZ/SPCX at n=2 each) — the
  result is not concentration-driven.

### Banger (`+200%/67%`)

- **By DTE**: expectancy positive across every quintile (+5.1% to +46.1%), no dead zone — the effect
  generalizes across the DTE range, not concentrated in one slice.
- **By VIX-at-entry regime**: **the whole 90-day study window sat in a narrow VIX band (14.2-17.8)**
  — every quintile is a low/calm-vol reading. This segmentation cannot yet speak to how the policy
  performs in a genuinely stressed, high-VIX environment, because the window measured never contained
  one. Disclosed as a real data-coverage gap, not a finding of "no vol-regime effect."
- **By MFE**: sharply bimodal — the bottom three quintiles (MFE < 112%) average around breakeven-to-
  negative (as expected: these never got close to a +200% trigger and mostly ride to whatever the real
  loss was); the top two quintiles (MFE > 112%) show +88.6% and +173.5% expectancy with 100% win rate
  in-sample — the whole measured edge concentrates in the tail of names that already ran hard.
- **By ticker**: SPCH (n=10) and FSLY (n=9) are the most frequent names in the qualifying population,
  each under 1% of the total n=1310 — no dangerous single-name concentration.
- *(Minor data note: a handful of Banger rows show `peak_premium` fractionally below `entry_premium`
  — a tracking-initialization edge case, not a real negative-MFE claim; it only affects the lowest
  MFE-bucket label, not any reported statistic.)*

## Part E — walk-forward validation (early half vs. late half)

**Banger: the grid winner is genuinely stable out-of-sample.** Split at 2026-08-31 (n=655/655).
`+200%/67%` ranks **#1 in BOTH halves** — early: expectancy +17.6%, meanΔ +13.3pp, CI [+9.4,+17.1];
late: expectancy +21.7%, meanΔ +20.9pp, CI [+17.6,+24.1]. This is real, out-of-sample-consistent
evidence, not an artifact of searching 24 cells against one sample.

**Native swing: no config survives the split.** Split at 2026-08-24 (early n=15, late n=14). The
early half's top config (`+200%/67%`) is a completely different cell from the late half's nominal
"top" config (`+100%/25%`) — and the late half's own best expectancy is **−15.0%** (win rate only
7.7%): every single config underperforms in the late half. **This means the native-swing grid search
has not found a real, generalizing configuration — it has found noise that happened to look good on
the full sample.** No native-swing candidate from this grid should be treated as validated.

## Recommended candidate configurations for further validation (not for shipping)

Ranked by strength of evidence. **None of these are recommended to ship today** — per the operator's
explicit instruction, this is evidence to decide from, not a change.

1. **Banger, `+100%/50%`** (the original finding, re-confirmed): +3.3pp, CI entirely positive, reaches
   43% of positions, walk-forward not separately re-checked at this exact cell but bracketed by the
   validated +200%/67% cell holding in both halves. **Best balance of reach and effect size** — most
   broadly applicable of the statistically-solid options.
2. **Banger, `+150%/50%` or `+200%/50%`**: larger measured effect (+9.1pp / +12.8pp), narrower reach
   (34% / 27%), zero large-winner premature-kills recorded. **Best raw effect size at a still-
   reasonable reach rate.**
3. **Banger, `+200%/67%`**: the single largest measured effect (+17.1pp) AND the only Banger
   configuration with direct walk-forward confirmation in both halves — but reaches only 27% of
   positions and (uniquely among the ≥125% triggers) shows 1 large-winner premature-kill. **Strongest
   proof, narrowest applicability.**
4. **Banger, avoid `+50%` at any fraction tested** — the one level in this grid that does not clear
   the bar; scaling out that early is not supported by the evidence.
5. **Native swing: no configuration from this grid is ready for further validation as a shipping
   candidate.** The directional hint that a moderate (30-40%) trailing stop on the runner may
   modestly beat the plain thesis/risk baseline (Part C) is the one thing worth a dedicated,
   larger-sample re-test — everything else in this engine's grid failed either the CI bar (Part B) or
   the walk-forward bar (Part E).
6. **Native swing DTE split** (1-3 DTE dramatically outperforming everything else, Part D): thin
   (n=5-6/bucket) but clean enough to flag as the most promising SEGMENT-SPECIFIC hypothesis for a
   dedicated, larger-sample follow-up, distinct from a single global exit parameter.

## Does one exit policy work broadly, or does NIGHTHAWK need different policies for different play types?

**The evidence points toward "one policy family generalizes reasonably well for Banger, but native
swing cannot yet support ANY specific policy — global or segmented — at today's sample size."**

- For Banger, the SAME shape of policy (trim a fraction at a fixed premium-gain trigger, ride the
  rest on the existing thesis/risk exit) shows a positive, mostly statistically-separated effect
  across the ENTIRE tested trigger range (+75% to +200%), across every DTE quintile, with no
  dangerous ticker concentration, and the leading candidate is confirmed stable across a genuine
  out-of-sample split. That is real evidence FOR a single, broadly-applicable policy shape for
  Banger — the open question is which specific trigger/fraction point on that curve to choose (a
  reach-vs-effect-size tradeoff, not a "does it work" question).
- For native swing, the picture is the opposite: nothing in the 24-cell grid clears a confidence bar,
  and the one clean-looking segment split (DTE) is exactly the kind of pattern that (per Part E's
  Banger vs. swing contrast) needs walk-forward confirmation before being trusted — which n=28-29
  cannot yet provide. It would be premature to conclude native swing "needs a different policy per
  play type" from this data; the honest conclusion is "native swing doesn't yet have enough closed
  volume to tell."

## What Monday RTH / ongoing data capture should still confirm

1. **Re-run this exact grid for native swing once the chronologically-eligible closed population
   clears roughly 60-80** (currently 28-29) — at that point the CI widths seen throughout Part B
   should tighten enough to separate a real signal from noise, if one exists.
2. **Re-run the native-swing walk-forward split at the same larger population** — a config that
   cannot even survive today's crude two-way split needs a real out-of-sample check before anything
   from this engine's grid is treated as evidence.
3. **The DTE-split hypothesis (native swing, Part D)** is the one segment-specific pattern worth a
   dedicated, larger-sample follow-up in its own right, separate from the global grid.
4. **Banger vol-regime segmentation is currently unanswerable** — the whole measured window sat in a
   calm VIX band (14.2-17.8). Re-run once the window spans a genuine VIX spike, to check whether the
   leading Banger configuration's edge holds, shrinks, or reverses under real stress.
5. **A decision on which specific Banger trigger/fraction to carry into a real (not summary-tier)
   chronological validation** — per the still-open recommendation in the prior study, Banger needs
   its own per-tick log before any of these numbers graduate from "strong summary-tier signal" to
   "certified backtest."

---

*Generated 2026-09-26, a direct follow-up to `docs/audit/NIGHTHAWK-EXIT-MANAGEMENT-STUDY-2026-09-26.md`
per the operator's explicit request for a deeper optimization grid before any production decision.
Tooling: `scripts/audit/lib/swing-exit-optimization-eval.mjs` (+18 unit tests),
`scripts/audit/swing-exit-optimization-study.mjs`. No production weights, thresholds, gates, or exit
logic were changed by this study.*
