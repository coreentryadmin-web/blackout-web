# Banger Exit Candidate Head-to-Head Validation — 2026-09-27

> **kind:** REPORT — evidence for further validation only. **No production behavior was changed.**
> Native swing was **not** touched, per the operator's explicit instruction to let its closed
> population grow before any re-run.

## The ask

Following the exit-optimization grid study (`NIGHTHAWK-EXIT-OPTIMIZATION-GRID-2026-09-26.md`), the
operator asked for a deeper, trade-level head-to-head between:

- **Candidate A** — +100% trigger / 50% scale-out
- **Candidate B** — +200% trigger / 67% scale-out

against Banger's **real, current production exit behavior**, with full trade-level results (not
just aggregates), an explicit overfitting/outlier check, and walk-forward separation intact.

## What Banger's current production exit actually is (verified against code, not guessed)

`src/lib/zerodte/scale-out.ts`'s `SCALE_OUT_RULES` (shared by the live `deriveScaleOutAction` state
machine and the backtest grader, so there is only one rule to describe):

- **Partial**: realize 50% of the position when the mark first reaches **2.0× entry (+100%)**.
- **Runner**: after the partial, exit the remaining 50% if the mark retraces to **50% of its own
  peak** (a trailing stop measured off the running high, not off entry).
- **Hard stop**: before any partial fires, exit the whole position if the mark falls to **0.4×
  entry (−60%)**.
- **Expiry**: an unquoted contract still open at expiry settles at intrinsic value (calls only).
- No time stop, no second rung.

This matters directly for how to read the results below: **Candidate A is not an alternative
policy — it is production's own real rule**, restated as a grid cell. Candidate B is the genuine,
distinguishable alternative (a later, bigger partial).

## Data & methodology

- **Source**: `GET /api/admin/banger/closed-export?days=270` — every closed Banger position
  (`status IN ('CLOSED_RUNNER','STOPPED')`) over the trailing 270 days. **n = 1,310** closed
  positions, chronologically sorted by `closed_at`.
- **No per-tick history exists for Banger** (peak/trough are running max/min columns, no log) — the
  same disclosed "single-peaked-path" summary-tier approximation the exit-optimization grid study
  used. This is why native swing (which DOES have per-tick history) is excluded from this exercise
  entirely — this report is Banger-only, as instructed.
- **Look-ahead discipline**: every candidate is evaluated from `entry_premium`/`peak_premium`
  (both real, pre-existing columns — `peak_premium` is a running max Banger's own live-sync already
  maintained tick-by-tick in production, not something computed with hindsight) and the real
  recorded terminal outcome. No future information beyond what production itself already recorded
  is used.

### A real modeling correction found while building this (verify, don't assume)

For the ~43% of closed rows where a real partial already fired (`scaled_already: true`), the
exported `realized_pnl_pct` is **itself already a blend** — `0.5×100 + 0.5×rawRunnerReturn`. Feeding
that number straight into the same grid-cell formula used for Candidate A (which is *also*
100%/50%) would **double-blend** it, producing a spurious "difference" from current that is a
modeling artifact, not a real one.

Fix: for any `scaled_already: true` row, invert production's own fixed, known blend to recover the
raw single-leg return the position would show had it ridden unscaled to its real final exit mark:

```
rawFullReturnPct = 2 × realized_pnl_pct − 100
```

Verified against a real row before trusting it (DBX id=49, 2026-08-04): entry $0.50,
`realized_pnl_pct` 55%. `2×55−100 = 10` implies an exit mark of `0.50×1.10 = $0.55` — which **is**
that row's own `last_mark` column, confirming the formula exactly. This reconstruction (never the
raw exported field) is what both candidates are evaluated against; `current` itself is never
altered. 12 unit tests cover this (`scripts/audit/lib/banger-exit-headtohead-eval.test.mjs`),
including a parameterized proof across six different underlying returns.

### Proof, not assertion: Candidate A reproduces `current`

Running the corrected model: **1,309 of 1,310 rows (99.92%) are byte-identical** to the real
recorded outcome. The **one exception is a real, separate production finding**, not a modeling
gap — see below.

## Full-population head-to-head

*(1-unit-notional-per-trade proxy throughout — "total return" and "max drawdown" are equal-weighted
sums/curves across the 1,310 trades in this sample, not real portfolio dollars; every trade in the
sample carries a different real strike/premium/size, so this is a comparability proxy, disclosed
rather than presented as a P&L statement.)*

| Metric | Current (real) | Candidate A (+100%/50%) | Candidate B (+200%/67%) |
|---|---|---|---|
| n | 1,310 | 1,310 | 1,310 |
| Reach rate (trigger ever hit) | — | 43.2% | 27.2% |
| Stop rate (`STOP_OUT`, unaffected by any candidate — see note) | 56.6% | 56.6% | 56.6% |
| Win rate | 43.1% | 43.2% | 36.0% |
| Median realized return | −60.0% | −60.0% | −60.0% |
| Expectancy (per trade) | — | +2.6% | **+12.1%** |
| Profit factor | — | 1.1 | **1.3** |
| Avg giveback from peak (pts) | 272.8 | 272.8 | 263.3 |
| Avg MFE captured | — | 26.9% | 30.8% |
| Total return (sum, pts) | 3,360.9 | 3,440.9 | **15,889.3** |
| Max drawdown (equity curve, pts) | −9,680.8 | −9,680.8 | **−4,007.0** |
| Mean delta vs current (95% CI) | — | +0.1pp [−0.1, +0.2] | **+9.6pp [+7.2, +11.9]** |
| Verdict | — | INCONCLUSIVE (expected — see below) | **CANDIDATE SEPARATED (better)** |

**Stop rate is identical across all three columns by construction**: `STOP_OUT` fires *before* any
tranche is ever taken, so a position that stops out never reaches either candidate's trigger check
either — changing the profit-take rule cannot change how often the hard stop fires. This is not a
finding, it is a structural invariant worth stating so it is not misread as one.

**Candidate A's near-zero delta (+0.1pp) is the expected, correct result** — it is production's own
rule. The 1 real mismatch (id 1195, ticker ETHA) is addressed separately below.

## Overfitting / outlier check (Candidate B)

The operator specifically asked whether B's advantage is a handful of trades. It is not:

- **Concentration**: of the total +12,528pp summed delta across the population, the single largest
  mover contributes **−1.4%** (i.e. a net drag, not the driver), the top 5 contribute **−1.6%**, the
  top 10 contribute **+2.3%**. The advantage is broad-based, not outlier-driven.
- **Leave-one-out**: removing the single largest-|delta| trade: mean delta +9.7pp, still SEPARATED.
  Removing the top 5: +9.8pp, still SEPARATED. Removing the top 10: +9.4pp, still SEPARATED.
- **Trimmed mean** (drop the extreme 5% on each tail, n=1,180): +9.4pp — nearly identical to the raw
  +9.6pp mean. A result driven by outliers collapses under trimming; this one does not.
- **Walk-forward** (early half n=655, split 2026-08-31, late half n=655): early +6.8pp CI
  [+3.6, +10.1] SEPARATED; **late +12.3pp CI [+9.0, +15.7] SEPARATED — the effect strengthens in the
  out-of-sample half, not decays.** This is the opposite of an overfit signature.

## Segmentation

**By ticker** (n≥10 only — 5 tickers clear this bar; every result comes back **INCONCLUSIVE** at
this sample size): SNXX (n=12, +18.2pp CI wide), MSTX (n=12), MUU (n=11), SPCH (n=10), ABTC (n=10).
No ticker concentration to flag — the broad population result is not secretly one name's effect,
but no single ticker has enough closed history yet to stand alone either.

**By DTE** (categorical — Banger's weekly-expiry discovery means DTE is a narrow, discrete field;
quantile bucketing collapsed into degenerate overlapping labels, so this is segmented by exact DTE
value instead): 4d (n=261, +10.3pp SEPARATED), 7d (n=256, +10.4pp SEPARATED), 8d (n=303, +8.5pp
SEPARATED), 9d (n=227, +8.6pp SEPARATED), 10d (n=263, +10.1pp SEPARATED). **Every DTE bucket
separates in the same direction** — this is not a DTE-specific artifact.

**By VIX-at-entry regime** (real daily VIX close on the session date, quintile bands, 1,310/1,310
coverage): 14.2–14.6 (+7.7pp SEPARATED), 14.6–14.9 (+3.0pp **INCONCLUSIVE**), 14.9–15.4 (+12.8pp
SEPARATED), 15.4–16.5 (+10.9pp SEPARATED), 16.5–17.8 (+13.4pp SEPARATED). Four of five VIX bands
separate; the one exception is not the calmest or most volatile band, so there is no clean
"regime-dependent" story here yet. The entire measured window sits in a comparatively narrow,
calm 14.2–17.8 VIX range — no real stress period is captured, the same caveat the original
exit-optimization study already carried for Banger's VIX-regime segmentation.

## What we gain / what we sacrifice (Candidate B specifically)

This is the real trade-off, and it should not be read only from the aggregate numbers above:

- **We gain**: materially higher per-trade expectancy (+12.1% vs +2.6%), a better profit factor
  (1.3 vs 1.1), and — importantly — a **shallower max drawdown on the equal-weighted curve**
  (−4,007pts vs −9,681pts). Fewer, later partials means less size is locked in early, but the
  trades that DO run further run much further, and the aggregate curve is both higher and less
  severe in its worst stretch.
- **We sacrifice**: Candidate B requires the position to reach 200% before banking anything, versus
  current's 100%. Of the **565 trades that were REAL winners under current** (already-locked-in
  gains), **93 (16.5%) would have closed as losers under Candidate B** — they peaked between 100%
  and 200%, never reached the later trigger, and rode the full position back down to whatever the
  real historical ending was. Of the **394 trades that were large winners (≥50%) under current**,
  **124 (31.5%)** end up substantially worse under B (below half their real gain). This is genuine,
  real single-trade whipsaw risk that the aggregate expectancy number does not show on its own — a
  member who would have banked a partial and been fine under today's rule instead rides the full
  position and can end up red under Candidate B, on a meaningful minority of what are currently
  real wins.

## The one real anomaly found (not a modeling artifact)

Row id 1195 (ETHA, committed 2026-09-18, entry $0.24): `peak_premium` is **exactly** $0.48 —
production's own 2.0× partial-trigger level — yet `scaled_already: false` and the position was
ultimately `STOP_OUT`'d for the full −60%. The position's own peak crossed the real partial trigger,
but no partial was ever taken. Most plausible explanation (not yet confirmed against logs): the
live-sync cron runs on a 5-minute cadence (`*/5 11-21 * * 1-5`); `peak_premium` is a running max
that can capture an intraday touch the 5-minute-cadence `TAKE_PARTIAL` check never observed in real
time if the mark spiked and receded between two polls. This is **1 case out of 1,310 (0.08%)** —
too rare to change the verdict above, and it affects current/A/B identically (a missed partial is a
missed partial regardless of which candidate is being tested) — but it is a genuine, real execution-
timing gap worth a separate look if the operator wants it chased (log correlation against Polygon's
own tick data for that window would confirm or rule out the poll-cadence theory). Not fixed here —
report only, per the same "raise, don't touch" discipline as every other genuine gap this lane
surfaces.

## Trade-level data

Full 1,310-row trade-level CSV (every column: ticker, entry/peak/trough premium, DTE, real
scale-out action/reason, current outcome, both candidates' realized return/triggered/delta/giveback)
delivered alongside this report.

## Recommendation

**No candidate ships from this report.** Per the operator's explicit instruction, this is evidence
for further validation, not a go/no-go decision:

- Candidate A is confirmed to be production's own current rule (no action implied).
- Candidate B shows a real, broad-based, walk-forward-strengthening advantage in expectancy,
  profit factor, and portfolio-level drawdown — but at the cost of turning a real minority of
  today's winners into losers by holding for a later, bigger trigger. Whether that trade-off is
  worth taking is a risk-tolerance decision, not a purely statistical one.
- The ETHA-shaped anomaly (peak crosses the real trigger, no partial fires) is worth a separate,
  narrow investigation regardless of which candidate (if any) moves forward, since it represents a
  real execution gap in the CURRENT rule too.
- Native swing remains untouched, per instruction — continue collecting closed native-swing trades
  before any re-run there.
