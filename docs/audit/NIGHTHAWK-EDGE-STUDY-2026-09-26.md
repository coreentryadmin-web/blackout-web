# NIGHTHAWK/Banger discovery-edge study — 2026-09-26

**Status: research/measurement only. No production weights, thresholds, gates, or discovery/commit
logic were changed as part of this study**, per the operator's explicit instruction. This document
is a ranked list of evidence-based findings and *candidate* follow-ups, not a change log.

**Scope.** Reconstruct, from data already captured by production, what NIGHTHAWK (native Swing
engine) and Banger (Engine B, the whole-market weekly-banger screener) knew at the moment each
historical position was committed, and measure what happened afterward: direction accuracy, entry
timing, contract/strike/expiration selection, MFE/MAE, and which pre-entry inputs actually separate
winners from losers — without look-ahead bias.

**Look-ahead discipline (how every number below was produced).** Every "predictor" reported here
comes from a field pinned at commit time and never mutated afterward (`entry_context` for native
swing's cortex/score/archetype/sub-lane fields, `commit.ts`'s own contract-selection fields, and the
discovery screen's own output for Banger). Every "outcome" comes from a field necessarily observed
strictly after entry (peak/trough premium, realized P&L, exit reason, exit timestamp). Neither
function ever reads the other's inputs — enforced by construction in two new, reviewable pure
modules (see Tooling below), the same discipline this repo's whole audit toolkit already uses
(`banger-discovery-edge-eval.mjs`, `swing-score-calibration-eval.mjs`, etc).

**Verdict discipline.** A pre-entry variable is only called "RANKS" when it shows BOTH a real spread
across quantile buckets AND a monotonic (Spearman) trend — a spread alone is never sufficient (this
toolkit's own history has a spread that scrambled instead of ranked). Buckets thinner than the
chosen `min-n` are always named, never silently dropped or silently trusted. "INSUFFICIENT DATA" is
reported explicitly rather than forcing a verdict on a population too thin to support one.

**Data sources used (no new admin route was needed for either engine):**
- Banger: `GET /api/admin/banger/closed-export?days=365` (admin-gated, built 2026-09-25) — **n=1310**
  closed positions (CLOSED_RUNNER + STOPPED), full 365-day history available.
- Native swing: `GET /api/market/swing/record?days=90` (member-facing route)'s `closedDeck[]` —
  **n=39** closed positions, capped at the route's own 90-day/MAX_DAYS window.

**Tooling built this pass (new, additive, read-only — nothing here touches discovery/commit code):**
- `scripts/audit/lib/swing-discovery-edge-eval.mjs` + `.test.mjs` (10 unit tests) — swing-shaped
  `derivePreEntryMetrics`/`deriveOutcomeMetrics`/`deriveRowMetrics`/`groupByCategory`, reusing
  `banger-discovery-edge-eval.mjs`'s generic bucketing/verdict/Spearman/baseline machinery
  unmodified.
- `scripts/audit/swing-discovery-edge-analysis.mjs` — the live orchestration script that produced
  every native-swing number below. Usage:
  `node --import tsx scripts/audit/swing-discovery-edge-analysis.mjs --days=90 --min-n=3`.
- Banger's own `scripts/audit/banger-discovery-edge-analysis.mjs` + `lib/banger-discovery-edge-eval.mjs`
  already existed (built in a prior session) but had never actually been run or documented — this
  pass ran it for the first time against the full available 365-day history.

---

## Ranked findings

Ranked by strength of evidence (sample size × replication × cross-metric agreement), highest
confidence first. Each carries the concrete numbers, an honest read of what it does and doesn't
prove, a candidate follow-up with expected benefit, and the regression risk of acting on it.

### 1. Banger: cheaper/smaller/less-crowded setups dramatically outperform — but this is one factor measured four correlated ways, not four independent confirmations

**Evidence (n=1310, 365d, quantile-bucketed, 262/bucket):**

| Variable | Verdict (win rate) | Cheapest/smallest bucket | Priciest/largest bucket |
|---|---|---|---|
| Entry premium | INVERTED, rho=-1, spread=38.5pp | $0.03-0.30: **66.0%** win, avg P&L **+29.8%** | $2.01-20.60: **27.5%** win, avg P&L **-17.8%** |
| Discovery dollar-volume | INVERTED, rho=-0.9, spread=30.1pp | $4.9M-51M: **62.6%** win, avg P&L **+21.6%** | $826M-32.6B: **32.4%** win, avg P&L **-8.0%** |
| Discovery volume (shares) | INVERTED, rho=-0.9, spread=17.9pp | 754K-2.2M sh: **55.0%** win | 20M-253M sh: **37.0%** win |
| Price at discovery | INVERTED, rho=-1, spread=19.9pp | $5-11: **54.6%** win, avg P&L **+11.7%** | $99.63-398.69: **34.7%** win, avg P&L **-9.4%** |

Every one of these four variables is INVERTED on win rate, 100%+MFE-hit, avg realized P&L, and avg
MFE simultaneously (only the 100%+REALIZED hit rate stays FLAT across all four — see finding #3 for
why). This is the single most consistent pattern in either dataset.

**Honest caveat — read this before treating it as four confirmations.** Entry premium, discovery
dollar-volume, discovery volume, and price-at-discovery are not independent: a cheap, low-float,
low-dollar-volume name is very likely to *also* have a cheap option premium and a low share price.
This is very plausibly **one underlying factor (name/liquidity size) expressed four correlated
ways**, not four separately-confirmed effects. The bucketed rho (-0.9 to -1) is also much stronger
than the **direct, unbucketed Spearman correlation** on the same pairs (entry premium vs realized
P&L: rho=-0.235, n=1310; discovery dollar-vol vs realized P&L: rho=-0.129) — bucketing at 262 rows
per bucket averages out real but noisy, right-skewed data (avg MFE across the whole population is
+275.4% with a long right tail), so the *population-level* trend is real but a *single trade's*
predictive power from this alone is weak.

**Candidate follow-up:** measure whether a composite "size/liquidity" proxy (e.g. discovery dollar
volume alone, since it's the cleanest single INVERTED signal) predicts outcome better than the
others combined, and whether the existing Banger discovery screens already implicitly select against
this factor. **Expected benefit:** if real and actionable, tilting Banger's ranking toward
smaller/cheaper names could meaningfully lift win rate and avg P&L, since the population-level gap
is large (30-40pp on win rate between quintiles). **Regression risk:** MODERATE — smaller/cheaper
names are also more prone to wide bid/ask spreads and slippage not captured by this backtest's
mid-price MFE/MAE convention; a real trade at these premiums may not fill or exit at the theoretical
mid. Do not act on this without first checking real fill quality/liquidity for the affected strikes.

### 2. Banger: discovery close-strength is the single cleanest RANKS signal in either dataset

**Evidence (n=1310):** discovery close-strength (0-1, how close the day's close sat to its high)
RANKS positively on 4 of 6 outcome metrics simultaneously — win rate (rho=0.7), 100%+MFE hit
(rho=0.7), avg realized P&L (rho=0.8), avg MFE (rho=0.7):

| Close-strength bucket | n | Win rate | Avg realized P&L | Avg MFE |
|---|---|---|---|---|
| 0.51-0.74 | 262 | 40.8% | -2.3% | 191.4% |
| 0.74-0.85 | 262 | 37.0% | -4.6% | 228.2% |
| 0.85-0.90 | 262 | 38.9% | -0.4% | 183.9% |
| 0.91-0.96 | 262 | 48.9% | +11.9% | 262.1% |
| 0.96-1.00 | 262 | 50.0% | +8.3% | 511.2% |

This is the only variable in the Banger dataset where 4 of 6 outcome metrics independently agree on
the same direction — a materially stronger internal-consistency signal than the size/liquidity
cluster in #1, even though the raw spread (13pp win rate) is smaller. Unbucketed Spearman is
weaker (rho=0.087-0.109) for the same reason noted in #1 — a real population trend, weak per-trade.

**Candidate follow-up:** measure whether raising Banger's existing close-strength threshold (already
one of its 4 screen filters, per `market-banger-scan.mjs`) trades population size for win rate at a
favorable ratio. **Expected benefit:** a cleaner, more consistent signal than #1, so a threshold
adjustment here is more defensible if a change is ever made. **Regression risk:** LOW-MODERATE —
tightening any screen reduces discovery volume; Banger's discovery is deliberately uncapped, so a
screen change is a real product-scope decision, not a tuning tweak, and should go through the same
scrutiny as any other screen-threshold change.

### 3. Convergent across BOTH engines: exit/profit-taking capture, not discovery, is the biggest gap between opportunity and realized result

**Evidence — Banger (n=1310):** 43.2% of ALL closed Banger positions had the underlying **MFE
opportunity** to reach a 100%+ gain (peak premium ≥ 2× entry at some point), but only **9.2%** ever
**realized** a 100%+ gain at exit. That is a **4.7×** gap between "the opportunity existed" and "we
banked it" — and it holds as a FLAT (not ranked) 100%+REALIZED-hit-rate across every quantile of
every pre-entry variable in #1 and #2 above (rho≈0.1-0.7 but spread only 1.9-5.0pp) — i.e., **no
discovery-time variable measured here predicts whether a 100%+ opportunity gets captured once it
exists.** That points the lever at exit management, not entry selection.

**Evidence — native swing (n=31, from the already-published `swing-early-trim-ab.mjs`, 2026-09-10):**
the shipped single-rung +100%-trigger exit is only reachable 12.9% of the time (4/31) — independently
measuring the same shape of gap (opportunity vs. capture) on a completely different engine with a
completely different methodology (this one replays the real exit-ladder logic on real MFE/MAE
values, rather than a bucketed correlation study).

**Two independently-built tools on two different engines land on the same structural conclusion**:
the entry side is finding real upside; the exit side is not capturing most of it. This is the
single most convergent, cross-engine finding in this whole study.

**Candidate follow-up:** design a Banger-side analogue of `swing-early-trim-ab.mjs` (paired,
same-trade comparison of the current exit rule vs. one or more earlier/additional scale-out rungs,
using each position's own real peak/trough path) before touching Banger's exit logic. **Expected
benefit:** POTENTIALLY LARGE — closing even a fraction of a 4.7× opportunity/capture gap would be a
much bigger EV lever than any discovery-side screen change. **Regression risk:** MODERATE — an
earlier trim rung mechanically caps some winners' upside in exchange for banking more of them;
without the paired-comparison methodology (not yet built for Banger) any change here is a guess, not
evidence — this is explicitly a "build the measurement first" item, not a "change now" item.

### 4. Native swing: TACTICAL sub-lane shows an elevated loss rate, replicated across two independent measurements two weeks apart

**Evidence:** `swing-loss-taxonomy-segment.mjs` (2026-09-10, n=31 closed, 27 classifiable) found
TACTICAL diverging from the 44.4% aggregate loss rate: **n=5, 80% loss rate**, the only segment
clearing its own ≥20pp-divergence-at-n≥5 bar. This pass's fresh, independently-built
`swing-discovery-edge-analysis.mjs` (2026-09-26, n=39 closed) finds the same sub-lane again, now at
n=6: **83.3% loss rate (16.7% win), avg realized P&L +40.6%, avg MFE +92.9%** — i.e. still losing
most of the time, but the (rare) wins are large (a lottery-ticket-shaped payoff, not a systematic
+EV-vs-STANDARD trade quality issue).

**This is the highest-confidence NATIVE swing structural finding in this study** — not because n is
large (it isn't: 5→6), but because it is the ONE finding that replicated, independently measured, in
two different sessions two weeks apart on a growing (not identical) population.

**Candidate follow-up:** once TACTICAL's closed population clears a real n (≥15-20), re-run both the
loss-taxonomy segmentation and this pass's own bucketed analysis to see if the 80%+ loss rate holds
or was small-sample noise; if it holds, investigate what TACTICAL-lane management/entry logic
differs from STANDARD. **Expected benefit:** if real, tightening or re-tuning TACTICAL-lane entry
criteria could remove a genuinely bad sub-population. **Regression risk:** LOW to investigate
further, but the sample is still too thin (n=6) to justify any code change today — this is
explicitly a "keep watching, don't act yet" item per the operator's own instruction not to change
anything on a correlation alone.

### 5. Native swing: EXTENDED sub-lane shows the opposite, promising shape — first look

**Evidence (n=6, this pass only):** EXTENDED sub-lane: **66.7% win rate AND +44.5% avg realized
P&L** — the only sub-lane where both win rate and average P&L point the same positive direction at
once (STANDARD is mediocre on both: 48.1% win, **-16.3%** avg P&L; TACTICAL splits, per #4). Not yet
cross-validated against an earlier measurement (the 2026-09-10 loss-taxonomy pass did not call out
EXTENDED as diverging, likely because its population was thinner then).

**Candidate follow-up:** re-run as the EXTENDED population grows; if it holds past n≥15-20, it is a
genuine positive signal worth understanding (what does EXTENDED sub-lane classification actually
select for that STANDARD does not). **Expected benefit:** understanding a real edge source.
**Regression risk:** NONE from measurement alone; do not act on n=6.

### 6. Native swing: shorter DTE at entry associates with better MFE-based outcomes — first look, real but thin

**Evidence (n=39, this pass):**

| DTE bucket | n | Win rate | Avg realized P&L | Avg MFE |
|---|---|---|---|---|
| 1-2 days | 8 | 87.5% | **+91.8%** | **+137.5%** |
| 3-5 days | 8 | 25.0% | -1.2% | +78.8% |
| 5-8 days | 8 | 12.5% | **-41.5%** | +10.5% |
| 9-16 days | 8 | 37.5% | -31.6% | +15.7% |
| 16-30 days | 7 | 71.4% | -10.1% | +5.5% |

100%+MFE-hit and 100%+REALIZED-hit rates INVERTED cleanly (rho=-0.894, -0.866); avg MFE INVERTED
(rho=-0.9). Win rate itself is non-monotonic (the 1-2 day and 16-30 day buckets are both high,
5-8 days is the trough) — so this is NOT a clean "shorter is always better" story; the 5-8 day
bucket looks like a specific bad zone, not a smooth gradient. First time this has been measured for
native swing specifically (no prior CLAUDE.md entry on swing DTE).

**Candidate follow-up:** re-run at a larger n to see whether the 5-8 day trough is real or noise, and
whether it corresponds to a specific archetype/catalyst-timing overlap (e.g., DTE selected to
straddle an earnings date). **Expected benefit:** if real, a DTE-selection adjustment at commit could
avoid a genuinely weak window. **Regression risk:** LOW to investigate, but n=39 split five ways
(≈8/bucket) is thin — do not change contract-selection logic on this alone.

### 7. Convergent: NIGHTHAWK's own `score` does not reliably rank native-swing outcomes — replicated, real, but not yet actionable

**Evidence:** `swing-score-calibration.mjs` (2026-09-10, n=31, 10 quantile buckets, n=3-4 each):
verdict **SPREAD WITHOUT ORDER**, spread 66.7pp, rho=0.559 (just under the 0.6 RANKS threshold) — the
middle score band outperformed every high-score band. This pass's independent re-measurement
(2026-09-26, n=39, 5 buckets): also **SPREAD WITHOUT ORDER** on win rate (rho=0.316, spread 19.6pp),
and **FLAT-to-zero** on avg realized P&L and avg MFE (rho=0, spread 66.7% and 62.4% respectively —
large spread but literally zero rank correlation, i.e. the buckets differ a lot but not in score
order). Two independent measurements, two different sessions, agree: **`score` does not cleanly
separate winners from losers at current native-swing sample sizes.**

**This does not mean score is useless** — it may still correlate with something not captured here
(e.g. conviction under a specific archetype/regime), and n=31→39 is still thin for a 5-10-way split.
It does mean the headline `score` number, taken alone, should not be over-trusted as a ranking
signal today.

**Candidate follow-up:** re-run once population grows past ~60-80 closed positions (which would allow
a cleaner 5-bucket split at n≥12/bucket); separately, test whether score interacts with archetype or
cortex conviction rather than acting alone. **Expected benefit:** clarity on whether score needs
recalibration. **Regression risk:** NONE to keep measuring; do NOT touch score weighting on this
evidence alone — explicitly the kind of "looks correlated" conclusion the operator instructed not to
act on.

### 8. Native swing: SHORT positions win more often but earn less than LONG — thin, first look

**Evidence (n=39):** LONG (n=26): 42.3% win, avg realized P&L **+3.3%**. SHORT (n=13): 53.8% win,
avg realized P&L **-1.3%**. SHORT wins more often but by smaller amounts and/or loses bigger when it
loses; LONG wins less often but the average outcome is still net positive. A real, if thin (n=13),
asymmetric-payoff shape worth naming as its own line since "direction accuracy" was one of the
operator's named foci.

**Candidate follow-up:** re-run once the SHORT population grows; check whether this reflects a
structural difference in how SHORT theses are managed/exited versus LONG. **Expected benefit:**
clarity on whether SHORT-side management needs its own exit discipline. **Regression risk:** NONE
to keep measuring; n=13 is too thin to act on.

### 9. Native swing: cortex verdict is populated on only 4 of 39 closed positions — an honest coverage gap, not a null finding

**Evidence:** every cortex-derived pre-entry variable (cortexScore, cortexConviction, cortexDecision,
support/oppose/veto/absent counts) collapses to a single n=4 bucket and reports INSUFFICIENT DATA —
because only 4 of the 39 closed rows carry a populated `cortex` block in `entry_context` at all. This
is a genuine data-coverage limitation, not evidence that cortex doesn't matter: **the question "does
Cortex conviction predict native-swing outcome" is currently unanswerable from closed history.**

**Monday/ongoing data-capture item:** nothing new needs to be captured — cortex pinning at commit
already exists and is presumably firing on every fresh commit going forward (consistent with the
already-live `entry_context.cortex` shape this pass observed on the 4 populated rows). This is purely
a **wait-for-population-growth** item: re-run this same script once the closed population has more
cortex-tracked positions (confirm first whether cortex pinning was only recently turned on for swing
commits, which would explain the 4/39 ratio, vs. some rows genuinely missing it for another reason).

### 10. DATA-INSUFFICIENT, explicitly named per the operator's instruction: true "time to MFE" is not computable for either engine

**What's missing:** both `closedDeck` (native swing) and `closed-export` (Banger) carry peak/trough
**premium values** but no peak/trough **timestamps**. The only place a genuine per-tick, timestamped
MFE/MAE trail exists is `swing_position_snapshots` (append-only, per-tick, columns include
`created_at`, `option_mark`, `running_mfe`, `running_mae`, `thesis_state`) — but there is currently
**no admin export route exposing it externally**. Banger has no equivalent per-tick table at all.

**Exactly what to capture (Monday RTH and going forward):**
1. **Native swing:** build a read-only admin export route over `swing_position_snapshots`
   (mirroring the existing `closed-export`/`discovery-debug` admin-route pattern) exposing
   `(position_id, created_at, option_mark, running_mfe, running_mae, thesis_state)` per tick for
   closed positions. This alone would let a future pass compute true time-to-peak, thesis-state at
   peak, and whether a position's own thesis-invalidation lagged or led its price peak.
2. **Banger:** no equivalent tick-level table currently exists; the minimum viable capture would be
   stamping the peak/trough **timestamp** (not just value) at the point `updateBangerMfeMae` (or
   equivalent) records a new running peak/trough — a small, additive column, not a new table.
3. Until either exists, "time to MFE" and "did the thesis break before or after the price peaked"
   remain genuinely unanswerable questions for both engines — this study does not manufacture an
   answer to them.

**This was not built in this pass** — deliberately: it would require either a new admin route
(native swing) or a schema change (Banger), and the operator's instruction was explicit that this
study should not modify production logic. Flagging it as the single most concrete, well-defined
"what to capture next" item in this whole report.

### 11. DATA-INSUFFICIENT: "selected vs. rejected/watch/research candidates" is only partially answerable for native swing, and effectively unanswerable for Banger, from persisted history

**Native swing:** `swing_shadow_positions` gives a real, graded, historical comparison population —
but **only** for candidates that cleared every gate and were then turned away by the real-time
budget/book-percent risk cap specifically. The far more common rejection paths — G-S3 (earnings),
G-S4 (regime), G-S6 (confluence), G-S14 (Cortex) — have **no persisted historical rejection log**;
only today's live snapshot is visible (`discovery-debug` route). The existing
`swing-regime-gate-recall-probe.mjs` gets around this for G-S4 specifically by **reconstructing**
the candidate pool from raw historical UW flow + Polygon data and re-evaluating the real,
unmodified gate function against it — a proven, valid technique (see the already-published G-S4
result cited in finding context above: BLOCKED candidates graded 20.2pp worse than CLEAR ones,
n=116) — but it has not yet been extended to G-S3 or G-S6.

**Banger:** discovery is deliberately uncapped (no top-N slice, no gate stack) — the closest thing to
a "rejected" population is "names that failed one of the 4 screen thresholds," and there is currently
no persisted record of what failed the screens on any given day, only what passed and was committed.

**Exactly what to capture / do next:**
1. Extend the already-proven reconstruction technique (`swing-regime-gate-recall-probe.mjs`'s
   method) to G-S3 (earnings) and G-S6 (confluence) — no new capture needed, this is a "build the
   same kind of script again" item using data already available (real historical UW flow + Polygon
   bars), not a data-capture gap.
2. For Banger, the whole-market grouped-daily scan that `market-banger-scan.mjs` already performs
   for live discovery could, in principle, be re-run historically (Polygon grouped-daily is available
   for any past date) to reconstruct "what passed the 4 screens each day" and compare committed vs.
   screen-passed-but-never-committed names — this is a NEW analysis to build, not a data gap, since
   the raw Polygon data needed already exists historically.

### 12. DATA-INSUFFICIENT / thinnest real number in the study: entry-timing pre-entry drift

**Evidence (already published, `swing-pre-entry-drift-probe.mjs`, 2026-09-12):** of 30 real closed
chains, only **5** landed in the "measurable" bucket (9/30 were `insufficient_data` because
daily-bar granularity can't resolve a same/adjacent-day round trip). Of those 5, mean pre-entry drift
fraction was **50.0%** — i.e., on average, half of the eventual favorable move had already happened
*before* commit. This is the single measurement most directly on-point for the operator's "entry
timing" question, and also the thinnest (n=5) — a first look, not a conclusion.

**Exactly what to capture:** re-run this exact tool as the closed population grows (no new capture
needed — it already joins `GET /api/market/swing/record` with the admin
`accumulation-export` route correctly); separately, re-running against **minute bars** instead of
daily bars (already named as a limitation in the tool's own header) would resolve the 30% currently
falling into `insufficient_data` for lack of intraday resolution.

### 13. Confirmed correct-as-designed, not a finding requiring action: Banger direction is hardcoded LONG-only

Already verified this session (see the live journal, 2026-09-26 :16-offset entry): Banger's
LONG-only hardcode (`banger-lane-merge.ts:86`) is a deliberate, documented product-scope decision
(whole-market weekly-BANGER discovery = a momentum/breakout-call screener by design, per
`market-banger-scan.mjs`'s own header), not a hidden gap. No "direction accuracy" question applies to
Banger for this reason — listed here only so this study's own "direction accuracy" coverage is
complete and explicit about why Banger has no entry on this axis.

---

## Concrete examples (native swing, n=39, this pass)

**Top 5 winners by realized P&L:**
- EWZ (pos 29) LONG PULLBACK_CONTINUATION/TACTICAL: score=65, realized **+438.8%**, MFE +448.3%, target exit, held 5.8 days.
- CG (pos 25) SHORT/EXTENDED: score=3, realized **+221.2%**, MFE 221.2%, target exit, held 21.9 days.
- CRWD (pos 19) LONG SECTOR_ROTATION/EXTENDED: score=87, realized **+138.3%**, MFE 161.3%, target exit, held 26.9 days.
- RVMD (pos 7) LONG POST_EARNINGS_DRIFT: score=74, realized **+108.8%**, target exit, held 11.8 days.
- RKLB (pos 23) SHORT EVENT_DRIVEN: score=19, realized **+79.4%**, target exit, held 5.8 days.

**Top 5 losers by realized P&L:**
- IBIT (pos 8) SHORT: score=29, realized **-98.6%**, MFE was still +59.6% at some point, stopped, held 14.2 days.
- SPCX (pos 3) SHORT EVENT_DRIVEN: score=35, realized **-66.9%**, stopped, held 1.2 days.
- TSM (pos 11) LONG PULLBACK_CONTINUATION: score=65, realized **-62.3%**, MFE 42.2%, stopped, held 4.9 days.
- NRG (pos 34) LONG: score=27, realized **-62.2%**, MFE was 132.7% at some point, stopped, held 11.8 days.
- INTC (pos 18) LONG SECTOR_ROTATION: score=84, realized **-61.6%**, MFE 18.9%, stopped, held 1.9 days.

**Largest forgone-upside gaps (MFE reached, then given back before/at exit):**
- NRG: MFE +132.7% → realized -62.2% (194.9pp gap), stopped.
- IBIT: MFE +59.6% → realized -98.6% (158.2pp gap), stopped.
- KKR: MFE +203.8% → realized +50.5% (153.3pp gap), target (still a win, but banked far less than the peak).
- SPCX (pos 10): MFE +53.7% → realized -29.9% (83.5pp gap), stopped.
- MSFT: MFE +132.3% → realized +68.2% (64.1pp gap), target (a win, but nearly half the peak given back).

These five examples are the clearest illustration of finding #3 (the opportunity-vs-capture gap) on
the native-swing side specifically — note that `score` was high on two of the biggest losers (INTC
84, TSM 65) and unremarkable-to-low on some of the biggest winners (CG 3, RKLB 19), consistent with
finding #7 (score does not cleanly rank outcome at this sample size).

---

## Priority order for next steps (no code changes implied by this list)

1. Build the Banger-side paired exit-rule comparison (analogue of `swing-early-trim-ab.mjs`) — the
   single largest, most convergent EV lever identified (#3).
2. Extend the regime-gate reconstruction technique to G-S3/G-S6 (#11) — closes the biggest remaining
   "selected vs rejected" gap for native swing at zero new data-capture cost.
3. Re-run `swing-score-calibration.mjs` and this pass's own score-bucketing once the closed
   population grows past ~60-80 (#7) — needed before any score-weight conversation is even
   well-posed.
4. Watch (don't act on) the TACTICAL/EXTENDED sub-lane split (#4, #5) and the DTE trough (#6) as the
   closed population grows.
5. Decide whether to build the `swing_position_snapshots` export route and/or a Banger peak-timestamp
   column (#10) — the only way to ever answer "time to MFE" or "did the thesis break before or after
   the price peaked" for either engine.
6. Re-run `swing-pre-entry-drift-probe.mjs` (#12) and `swing-cadence-gap-recall-probe.mjs` as the
   closed population grows; consider a minute-bar re-run of the former to resolve its 30%
   `insufficient_data` rate.

---

*Generated 2026-09-26 as part of the standing Ask Largo × Night Hawk Swings ownership mandate
(`CLAUDE.md`). Read-only research pass — see the tooling files listed above for full reproducibility.*
