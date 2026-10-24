# Banger Exit — Adversarial Validation of 100%/33%/70% (2026-09-27)

> **kind:** `FINDING`

**Operator directive (verbatim):** *"Before we touch production, I want you to try to break the 100%
trigger / 33% partial / 70% trail configuration. Run a strict validation using data that was NOT used
to select this configuration. Test: True out-of-sample performance; Early vs late OOS; By year; By
ticker; Bull, bear, sideways, high-volatility and low-volatility regimes; Realistic slippage/fills;
Expectancy; Profit factor; Win rate; Max drawdown; Median trade; Tail losses; Large-winner capture;
Winner-to-loser flips; Total sample size. Compare 100/33/70 directly against current production
100/50/50 on identical trades. Most importantly, investigate why expectancy jumps from +2.6% to
+97.4%. Prove that improvement comes from legitimate runner capture and is NOT caused by leakage,
look-ahead bias, incorrect return reconstruction, a small number of extreme winners, or another
implementation bug. Do NOT optimize another configuration and do NOT change production. I want an
adversarial validation of 100/33/70 specifically. Try to disprove it. Give me the raw results,
trade-level comparison, and failures/weaknesses you find. If it survives everything, tell me exactly
why it survives."*

**No production code was changed. No configuration is recommended for shipping.** This is evidence
only, per the standing instruction.

## Headline verdict

**The +2.6% → +97.4% expectancy jump, as originally reported, is NOT legitimate.** It is overwhelmingly
(74.4% of the entire summed advantage) an artifact of a known, already-partially-fixed production bug
(`PR #4969`, 2026-09-14) that permanently poisoned `peak_premium` on 101 of 1,310 closed positions
(7.7%) with backstop-quote values that were never real, tradeable prices.

**After removing those 101 contaminated rows, a smaller, genuine, non-outlier-driven edge remains:
+26.3pp mean delta (expectancy 100/50/50 = −5.5% vs 100/33/70 = +20.8%), 95% CI [23.5, 29.1], stable
under leave-out-top-20 (drops only to +22.5pp) and 5%-trimmed-mean (+18.8pp).** This is real
information, not zero — but it is **~3.7x smaller** than the number originally quoted, and the
population it's measured on (n=1,209) is missing the one independent validation this study set out to
get (real historical bar replay), for reasons explained below. **Do not treat +26.3pp as a shippable
number either** — it still needs the same real-bar/liquidity caveats section 4 describes, and the
peak-contamination bug itself is a separate, standing data-integrity issue worth its own fix, not
addressed here per the explicit "do not change production" instruction.

---

## 1. Root cause of the +2.6% → +97.4% jump (the central ask)

### 1.1 What was found

`peak_premium` (`src/lib/banger/positions-db.ts`) is a **monotonic running max**, ratcheted via SQL
`GREATEST(peak_premium, new_mark)` on every live-mark tick. It never decreases. `PR #4969`
(`fix(swing): don't let a zero-bid backstop quote inflate live banger P&L`, merged 2026-09-14)
documents — in its own commit message — a real, live-confirmed incident: a market-maker "backstop"
ask on a contract nobody is bidding on (bid=$0, ask=$15) produces a naive bid/ask mid of $7.50 that is
not a real, fillable price. CRSR's real quote showed exactly this shape on 2026-09-14: `last_trade`
and `session.close` both $0.07 (flat, matching its own entry premium) while the naive mid read $7.50 —
a 107x divergence — and the same PR names five other BANGER positions with the identical shape same
session: **EBS, CPRI, PAGS, BAND, ACVA**.

`reliableMarkFromSnapshot` (added by that PR) now falls through to the last-trade/close reference when
this divergence is detected — **but only for marks read after the fix deployed.** Because
`peak_premium` only ever ratchets upward, **any position whose peak was already poisoned before
2026-09-14 carries that contamination permanently** — the fix cannot retroactively repair a value
already at its monotonic max in the database.

### 1.2 Quantifying it

Built a mechanical, disclosed screen (`scripts/audit/lib/banger-backstop-contamination-eval.mjs`,
7 unit tests) — flag a row when its `peak_premium` is shared **exactly** by ≥3 genuinely different
tickers **and** implies a ≥500% peak return. Both conditions are required (shared-but-plausible peaks
are common by tick-size coincidence at n=1,310; a genuinely huge SOLO winner is not evidence of
anything on its own).

| Metric | Value |
|---|---|
| Suspect rows | **101 / 1,310 (7.7%)** |
| ...dated before the 2026-09-14 fix | 92 |
| ...dated on/after the fix (residual gap — see §1.4) | 9 |
| Share of the FULL population's total summed candidate delta | **74.4%** (92,461pp of 124,245pp) |
| Mean production-REAL `realized_pnl_pct` on suspect rows | **+98.9%** |

The last row matters: **production's own real, banked outcome is also inflated on these same rows** —
not just this backtest's reconstruction. The live exit decision that closed these positions used the
same poisoned mark path (before the 2026-09-14 fix), so some fraction of Banger's reported historical
track record itself likely carries this contamination. That is a standing data-integrity question
outside this study's scope (no production change was made here) — flagged for a separate follow-up.

Manual spot-check confirms the screen: **CRSR, EBS, CPRI, PAGS** — four of the six tickers named
verbatim in PR #4969's own commit message — are all inside the flagged set, sharing `peak_premium =
$7.50` with entry premiums of $0.04–$0.10 (implying 5,000%–18,650% "peak returns" that were never
real, tradeable prices).

Top 10 individual deltas driving the original +97.4% figure — every single one is a suspect row:

| id | ticker | current | candidate | delta | peakPct |
|---|---|---|---|---|---|
| 922 | PAGS | 31.3% | 8759.8% | +8728.5pp | 18650.0% |
| 463 | VSTM | 62.5% | 8759.8% | +8697.3pp | 18650.0% |
| 466 | KYTX | 75.0% | 7001.0% | +6926.0pp | 14900.0% |
| 408 | AMRX | 375.0% | 7001.0% | +6626.0pp | 14900.0% |
| 987 | CRSR | 35.7% | 4991.0% | +4955.3pp | 10614.3% |
| 990 | EBS | 37.5% | 3483.5% | +3446.0pp | 7400.0% |
| 970 | CPRI | 50.0% | 3483.5% | +3433.5pp | 7400.0% |
| 420 | NEXT | 62.5% | 2897.3% | +2834.8pp | 6150.0% |
| 257 | SMCY | 125.0% | 2897.3% | +2772.3pp | 6150.0% |
| 409 | KOPN | 28.9% | 2671.8% | +2642.9pp | 5669.2% |

Note the exact-duplicate `peakPct` pairs across unrelated tickers (PAGS/VSTM both 18650.0%,
KYTX/AMRX both 14900.0%, EBS/CPRI both 7400.0%, NEXT/SMCY both 6150.0%) — the signature of a shared
backstop-quote artifact, not independent price action.

### 1.3 Outlier concentration, full vs clean population

| | Full population (n=1,310, contaminated) | Clean population (n=1,209, suspect rows excluded) |
|---|---|---|
| Control expectancy | **+2.6%** | **−5.5%** |
| Candidate expectancy | **+97.4%** | **+20.8%** |
| Mean delta [95% CI] | +94.8pp [67.2, 122.5] | **+26.3pp [23.5, 29.1]** |
| Top-1 trade's share of total delta | 7.0% | 1.6% |
| Top-20 trades' share of total delta | **53.1%** | **16.0%** |
| Leave-out-top-10 mean delta | 56.3pp | 24.0pp |
| Leave-out-top-20 mean delta | 45.2pp | 22.5pp |
| Trimmed mean (5% each tail) | 32.0pp | 18.8pp |

On the full population, the top 20 trades (1.5% of the sample) explain over half the entire summed
advantage — a textbook "driven by a handful of outliers" shape, and those 20 trades are overwhelmingly
the same 101 flagged contaminated rows. On the clean population, concentration collapses to a normal,
broad-based shape (top-20 share drops from 53.1% to 16.0%) and the edge survives every robustness check
— this is the genuine signal.

### 1.4 The residual gap (9 suspect rows on/after the fix date) — a weakness, disclosed

9 of the 101 flagged rows are dated on or after 2026-09-14, meaning the fix did not fully close the
hole. A second commit, `e85227ac2` (`fix(nighthawk): Legacy WS option mark had no backstop-quote
divergence guard, unlike the REST path`, #5006, also 2026-09-14), suggests the WS-based mark stream had
its own separate gap fixed the same day — plausibly explaining same-day residual contamination if a
position's peak was set via the WS path before that second fix landed intraday, or if some other quote
path still lacks the guard. **This was not chased down further — it is out of scope for a "do not
change production" validation task — but it means the true contamination rate could be slightly higher
than 7.7% for very recent positions, and the screen should be re-run periodically, not treated as a
one-time count.**

### 1.5 Direct answer to each ruled-out cause

- **Leakage / look-ahead bias**: not the driver. The contamination is a genuine, timeline-consistent,
  already-documented production bug (92/101 suspect rows predate the fix; the other 9 are a disclosed,
  separate residual gap) — not an artifact of this study's own methodology.
- **Incorrect return reconstruction**: the reconstruction math itself (`syntheticFullReturnPct`,
  `evaluateTrailGridCell`) was independently proven exact for the control cell in PR #5517/#5519 and is
  unchanged here. The bug is upstream, in the INPUT data (`peak_premium`), not the reconstruction
  formula.
- **A small number of extreme winners**: **confirmed, this is the dominant cause** — 101 rows (7.7%)
  explain 74.4% of the total advantage, concentrated in the top 20 by delta.
- **Another implementation bug**: **confirmed** — a real, named, dated production bug (PR #4969), not
  a hypothetical.

**Net: the improvement is NOT legitimate runner capture, as originally quoted.** A smaller, genuine
edge survives on the clean subset (see §2), but that is a materially different, much more modest claim
than "+97.4% expectancy."

---

## 2. Real-bar-replay ground truth — built to catch a DIFFERENT risk, found a data-availability wall

### 2.1 Why this layer exists

Independent of the contamination above, this study set out to test a second, separate risk named at
the outset: the summary-tier reconstruction assumes a **single monotonic decline from the final
recorded peak** to reach a tested trail level. If a position's real price path had multiple separate
peak-then-retrace cycles before production's own (looser, 50%) trail finally closed it, the
reconstruction could wrongly credit a TIGHTER candidate trail with a peak it could never have actually
observed (it would have exited earlier, at an earlier, lower peak).

Built `scripts/audit/lib/banger-real-bar-replay-eval.mjs` — a parametric clone of production's own
`gradeScaleOut` (`src/lib/zerodte/scale-out.ts`), replaying REAL Polygon daily option bars for both
control (100/50/50) and candidate (100/33/70) against the identical real price path. Verified exact
parity against production's own test fixtures (7 tests) and a constructed multi-peak adversarial
scenario proving the tighter candidate correctly gets its own, earlier, lower exit peak (1 test) before
trusting it for anything else.

### 2.2 What it actually found: a different, more fundamental data wall

Fetched real Polygon daily option bars for all 1,310 closed contracts (100% fetch success). A
**verification gate** — does control's real-bar replay reproduce the row's own real recorded
`realized_pnl_pct` within 3pp? — passed for only **739 / 1,310 (56.4%)**.

The failures are NOT random: production's live marks are **NBBO quote-mid** prices
(`src/lib/zerodte/live-marks.ts`/`marks-math.ts`), never trade prints, while Polygon's day-aggregate
bars only exist when an actual trade prints. For a thin weekly option, the quote-mid can move (and
peak) on days with zero trade prints — invisible to a trade-based replay. Confirmed directly: DBX
(id=49, a row PR #5517 used as its own ground-truth proof) shows a real recorded peak of $1.25, but
Polygon's own trade bars for that exact contract over the whole window never print above $0.65 — the
real peak was a quote-mid event with no confirming trade.

**Verification success is a strong, systematic function of the real outcome, not a random sample:**

| | STOP_OUT rows (crashes; near-certain to print a confirming trade) | EXIT_RUNNER/EXPIRED rows (real winners/scaled; often no confirming trade at the exact peak) |
|---|---|---|
| Full population | 742 | 568 |
| Verified | ~684 (92.2%) | ~55 (9.7%) |

**This means the 739-row "verified" real-bar population is not a fair test of the two configurations —
it is almost entirely pure hard-stops, where control and candidate are IDENTICAL by construction (both
share the same fixed −60% hard stop; neither rule ever engages).** That is exactly why this
population's own meanDelta is tiny (+2.0pp [1.1, 2.9]) — not because the real edge is that small, but
because the one subpopulation where the two rules actually diverge (scaled/runner trades) is
precisely the subpopulation real-bar-replay cannot verify.

**Conclusion: trade-print daily bars are not a valid ground-truth instrument for this specific
validation, at this instrument class (thin weekly options).** This is reported as a genuine limitation
found by trying to build the rigorous check the operator asked for — not hidden, not silently
substituted with the biased subset as if it were the answer. The liquidity bias is directly measurable:
median discovery $-volume for verified rows was $271.5M vs $132.7M for unverified — verification
concentrates in the more liquid names.

### 2.3 What this section DOES still support

- Whatever the 739-row STOP_OUT-dominated subset shows, the candidate is **never worse** than control
  on it (meanDelta +2.0pp, CI entirely positive) — a weak but real confirmation, consistent in
  direction with §1's clean-population finding, on the one slice of the real price tape this method
  could actually verify.
- Winner-to-loser flips on this subset: **0 / 55** real winners flip. (Weak evidence given the small,
  biased n — but consistent with the same zero-flip finding on the clean summary-tier population, §3.)
- Early vs late half of this subset (n=369/370, split 2026-08-26): meanDelta +2.2pp vs +1.8pp —
  stable, no decay.
- By SPY-regime (real bars, EMA trend-stack): BULL n=500 (+2.3pp), SIDEWAYS n=239 (+1.3pp) — both
  separated in the candidate's favor; no BEAR regime observed in this window (single ~7-8 week span).
- By VIX-median volatility split: HIGH_VOL n=370 (+1.6pp), LOW_VOL n=369 (+2.5pp) — both separated.
- With a disclosed 2.0% slippage haircut applied identically to both legs: meanDelta unchanged at
  +2.0pp (slippage moves both configs down by the same amount since they use the same number of legs
  on this stop-dominated subset).

None of this is a strong result on its own (n and composition are both compromised by the verification
wall) — it is reported for completeness and because it is directionally consistent with §1's much
larger, cleaner finding, not because it should be trusted in isolation.

---

## 3. Full metric suite — 100/33/70 vs production 100/50/50, CLEAN population (n=1,209)

This is the most trustworthy comparison this study produced: full summary-tier population, contaminated
rows removed, identical trades, same reconstruction math already proven exact for the control cell.

| Metric | Control (100/50/50) | Candidate (100/33/70) |
|---|---|---|
| n | 1,209 | 1,209 |
| Win rate | 38.4% | 38.5% |
| Expectancy | **−5.5%** | **+20.8%** |
| Profit factor | 0.85 | 1.56 |
| Median trade | −60.0% | −60.0% (unchanged — median trade is still a hard stop in both) |
| Total return (equal-weighted, pts) | −6,632.3 | **+25,151.8** |
| Max drawdown (pts) | −6,760.6 | **−1,910.3** |
| Real winners | 464 | — |
| Winner-to-loser flips | — | **0 / 464 (0.0%)** |
| Large winners (≥50%) | 340 | — |
| Large-winner degradation (<50% of original) | — | **0 / 340 (0.0%)** |
| Tail losses (worst 5%, n=60) | mean −61.3% | mean −61.3% (identical — both share the same fixed hard stop) |
| Large-winner capture (top decile of control's real winners, real-bar subset, n=74) | — | mean 126.6% of control's value |

**Zero winners flip to a loser, and zero large winners get degraded, on the clean population.** This
is a genuinely reassuring, mechanically-expected result: the candidate only changes when the RUNNER
portion exits (a tighter trail locks in sooner), never the entry, the partial trigger point, or the
hard stop (fixed, per the operator's explicit instruction) — so a real winner under production's own
rule cannot become a real loser under a rule that only trims the runner tighter.

### By ticker (n≥8, real-bar-replay subset — the summary-tier grid's ticker cells were mostly n<8 individually)

| Ticker | n | Win rate | Expectancy | Mean delta | Verdict |
|---|---|---|---|---|---|
| MSTX | 10 | 10.0% | −47.5% | +1.2pp | INCONCLUSIVE (n too small) |
| SPCH | 9 | 0.0% | −60.0% | 0.0pp | INCONCLUSIVE |
| NET | 8 | 0.0% | −60.0% | 0.0pp | INCONCLUSIVE |

No ticker has enough closed volume in this ~7-8 week window to support a standalone verdict — disclosed
honestly rather than manufactured.

### By year

**Single year (2026) — no cross-year comparison is possible.** The entire closed Banger population
spans session_date 2026-08-04 through 2026-09-24 (closed_at through 2026-09-25), a fixed ~7-8 week
window regardless of the `--days` parameter requested. Reported honestly rather than fabricated.

### Regime and volatility segmentation

Real SPY EMA-trend-stack classifier (`scripts/audit/lib/banger-regime-classify.mjs`, 8 unit tests) and
a VIX-median volatility split were built and applied to the real-bar-replay subset (§2.3) — both show
the candidate separated in its favor in every observed bucket (BULL, SIDEWAYS, HIGH_VOL, LOW_VOL). No
BEAR regime was observed in this window. These figures inherit the real-bar subset's liquidity bias
(§2.2) and should be read as directionally suggestive, not conclusive.

### Realistic slippage / fills

Extended `banger-real-bar-replay-eval.mjs` with an optional `slippagePctOfPremium` parameter — every
exit fill (hard stop, partial, trail-stop, or final mark) is degraded by the stated fraction, applied
identically to both configs. At 2.0% slippage on the real-bar subset, meanDelta is unchanged (+2.0pp)
— both configs absorb the same cost since they execute the same number of legs on this
stop-dominated subset. A slippage sensitivity on the larger, more decisive clean summary-tier
population (§1/§3) was not built — the summary-tier reconstruction operates on already-realized
premium fields, not a replayable price path, so a leg-by-leg slippage model doesn't have a natural
home there without re-deriving assumptions already disclosed as approximate. Flagged as a real gap in
this validation, not silently glossed over.

### Total sample size

1,310 total closed positions (fixed population, does not grow with a wider `--days` request) → 1,209
after excluding the 101 backstop-contaminated rows → 739 further reduced by the real-bar verification
gate for the (much weaker) ground-truth cross-check in §2.

---

## 4. Failures and weaknesses found (as requested)

1. **The headline +97.4% expectancy figure does not survive adversarial testing.** It is dominated
   (74.4% of the total delta) by 101 rows carrying a known, dated production data-contamination bug.
   This is the single biggest finding of this validation.
2. **True out-of-sample testing is not achievable with this dataset.** The entire closed population
   was already used when PR #5519's grid search selected 100/33/70 in the first place — there is no
   genuinely unseen data to test against, and the population does not grow with a wider date range
   (fixed at n=1,310). Early/late-half splits are reported, but they are not independent holdout —
   both halves were part of the original selection process. Disclosed rather than dressed up as a
   real walk-forward.
3. **Real-bar (trade-print) replay cannot serve as unbiased ground truth for this instrument class.**
   Production manages exits against continuous NBBO quote-mid prices; Polygon's daily bars only exist
   on a printed trade. Verification succeeds for 92% of real stop-outs but only 10% of real
   scaled/runner trades — precisely the population where the two configurations differ — so the
   "verified" subset is structurally biased toward the case where there is no difference to measure.
   This was the intended check for a DIFFERENT risk (multi-peak-cycle contamination in the
   reconstruction) and could not resolve that question either, for the same data-granularity reason.
4. **A residual 9-row gap exists past the 2026-09-14 fix date** in the contamination screen (§1.4),
   not chased to a definitive second root cause within this task's scope.
5. **By-ticker and by-year segmentation are both structurally degenerate** given the small, single-
   season, single-year closed population — reported honestly rather than manufacturing statistically
   unsupportable splits.
6. **No slippage sensitivity exists for the larger, more decisive clean-population comparison** (§3) —
   only for the smaller, real-bar-verified subset (§2), which is itself the weaker of the two results.
7. **The screen used to identify contamination (§1.2) is a conservative, disclosed heuristic, not a
   certified list.** It is possible a small number of the 101 flagged rows are genuine outsized winners
   that happen to coincidentally share a peak value with unrelated tickers — though the exact-duplicate
   percentage pairs (§1.2) and the direct name-match against PR #4969's own commit message make this
   very unlikely to explain more than a handful of the 101.
8. **Production's own real historical P&L may itself be inflated on these same 101 rows** (mean real
   `realized_pnl_pct` +98.9%, §1.2) — a standing data-integrity question about Banger's reported track
   record, separate from and larger in consequence than this exit-optimization study. Not investigated
   further or fixed here, per the explicit "do not change production" instruction; flagged for the
   operator's attention as a distinct, higher-priority follow-up.

## 5. Does it survive? — exact answer

**Not as originally quoted.** The +97.4% expectancy figure is not legitimate; it is a data-artifact
figure, not a runner-capture edge. **A materially smaller, genuine edge does survive**: on the clean,
contamination-excluded population (n=1,209, 92.3% of the full closed history), 100/33/70 shows
+20.8% expectancy vs production's own −5.5%, a +26.3pp mean delta [95% CI 23.5, 29.1] that:

- is **not** driven by a handful of outliers (top-20 share of total delta drops from 53.1% to 16.0%
  once contamination is removed; leave-out-top-20 barely moves the estimate, 26.3pp → 22.5pp);
- **never** flips a real winner into a loser (0/464) or meaningfully degrades a large winner (0/340);
- is directionally confirmed (weakly, on a liquidity-biased subset) by an independent real-bar-replay
  cross-check that never shows the candidate worse than control in any segment tested.

**Why it survives at all**: the mechanism is mechanically sound and narrowly scoped — 100/33/70 only
changes WHEN the runner portion exits (locks in more of a real peak, sooner, on a tighter trail), never
touching the entry, the partial-trigger point, or the fixed hard stop. A rule that can only trim a
winning runner tighter cannot, by construction, turn a real win into a real loss — which is exactly
what the zero-flip, zero-degradation result confirms mechanically, not just empirically.

**What is still missing before this could ever be treated as validated, let alone shipped**: a genuine
out-of-sample test (impossible with the current, fixed-size closed population), and an independent,
non-liquidity-biased ground-truth cross-check (blocked by the NBBO-quote-vs-trade-print data wall
described in §2). Both are disclosed as open, not glossed over. **No configuration is recommended or
shipped. No production code was changed.**
