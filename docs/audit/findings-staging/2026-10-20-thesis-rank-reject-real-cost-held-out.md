## 2026-10-20 — [FINDING, P2 Night Hawk 0DTE] thesis_rank_reject real-cost, held-out confirmation — momentum_abs_floor direction holds, real-option basis still too thin

> **kind:** `FINDING`

| **Status** | MEASURED (no gate/filter/exit rule changed — evidence only, per standing discipline) |
|---|---|

**Context.** Member directive: "Test thesis_rank_reject, especially momentum_abs_floor, using
point-in-time contract selection, historical option bid/ask quotes, realistic entry delay, costs
on both sides, and a chronological held-out validation set... Compare net expectancy, entry
timing, losses, and drawdown against the current baseline — not just win rate. Preserve current
exit management and risk controls during testing."

### Why this exists

`thesis-rank-reject-outcome-ab.mjs` (prior session) already found BREAKOUT/BREAKDOWN REJECT
setups (n=119, 10 real sessions) graded 68.1% WR vs PASS 53.0% WR, underlying-proxy basis, 112/119
tracing to `momentum_abs_floor` — but had **no real option cost and no TRAIN/VALIDATION split**,
both named as open gaps. New script `zerodte-thesis-rank-reject-real-cost-ab.mjs` closes both:
reuses that tool's exact real candidate-generation + `attachThesisFirstLive` machinery (never
reimplemented), grafts on the point-in-time-contract/real-NBBO/fee-bug-fixed grading machinery
already built in `zerodte-rvol-early-entry-unbiased-ab.mjs` (`resolveAtmContract`/
`fetchQuoteNear`/`fetchOptionBars`/`gradeRealOption`, copied verbatim including the
$100-multiplier fee fix), and adds a chronological session-day TRAIN/VALIDATION split. Contract
selection is point-in-time: the ATM strike is resolved from the REAL spot at the signal instant
(no look-ahead). Exit management (`PLAN_RULES` mechanical stop/target) is held IDENTICAL for
REJECT and PASS rows — isolates the gate decision, not entry speed or exit rules, as the variable
under test, per the member's instruction.

### Result (14 real session days, 2026-09-30…2026-10-19, 50 candidates/day cap, 699 classified)

| | TRAIN (7 days, n=350) | VALIDATION — held out (7 days, n=349) |
|---|---|---|
| REJECT / PASS split | 70 / 280 | 82 / 267 |
| **UNDERLYING_PROXY basis** | | |
| REJECT n / win rate / net expectancy | 67 / 73.1% / +1.01% | 62 / 66.1% / +0.86% |
| PASS n / win rate / net expectancy | 270 / 51.5% / +0.52% | 224 / 50.0% / +0.49% |
| REJECT avg loss / max drawdown | -0.33% / -2.25% | -0.39% / -1.50% |
| PASS avg loss / max drawdown | -0.52% / -7.50% | -0.52% / -9.00% |
| **REAL_OPTION basis (thin)** | | |
| REJECT n / win rate / net expectancy | 2 / 100.0% / +48.24% | 12 / 25.0% / -18.56% |
| PASS n / win rate / net expectancy | 10 / 40.0% / +4.10% | 19 / 42.1% / +4.63% |

`momentum_abs_floor` is the dominant REJECT driver in both halves (67/70 TRAIN, 78/82 VALIDATION;
the small remainder is `breakout_score_floor`).

### What this confirms, and what it does NOT

**Held-out confirmed, at underlying-proxy basis:** REJECT grades BETTER than PASS on BOTH win rate
and net expectancy, in BOTH halves (73.1%/+1.01% vs 51.5%/+0.52% TRAIN; 66.1%/+0.86% vs
50.0%/+0.49% VALIDATION) — same direction, similar magnitude, n well above the standing MIN_N=20
bar on both sides of the split in both halves. This is a real, repeated pattern, not a TRAIN-only
artifact, and it reconfirms the prior session's unconfirmed single-sample result.

**NOT confirmed at real-option (real-cost) basis — and this matters more than the proxy result.**
TRAIN's thin real-option sample (n=2 REJECT / n=10 PASS) points the SAME direction as the proxy
result (REJECT 100% WR vs PASS 40% WR) — but VALIDATION's real-option sample (n=12 REJECT / n=19
PASS) **inverts it** (REJECT 25% WR vs PASS 42.1% WR, net expectancy -18.56% vs +4.63%). Both
real-option samples are far below the n=20 trust bar, and raw rows were inspected for a repeat of
the earlier fee-calc bug (none found — every pnlPct falls within the PLAN_RULES -50/+100 bound or
a disclosed thin-liquidity time_stop/no-bar-crossed-the-stop exception, same market-microstructure
caveat the RVOL finding already discloses). **The underlying-proxy result and the real-cost result
disagree on direction in the held-out half** — the honest read is that the real-cost question
remains OPEN, not confirmed, despite the proxy basis looking clean in both halves.

**No gate changed.** The standing discipline ("a borderline-or-better underlying-basis result
earns a real-cost, held-out re-grade before touching a gate, not a direct change") is now
satisfied in the sense that the re-grade was run — but its answer is "the real-cost sample is too
thin to decide," not "confirmed, loosen `momentum_abs_floor`." The correct next step is growing
the real-option sample (more session days; most BREAKOUT/BREAKDOWN candidates still have no
liquid same-day-expiry option, the same market-structure constraint the RVOL finding names — so
growing *session count*, not candidate cap, is what grows this specific basis's n), not a gate
change on the proxy basis alone.

### Blast radius

No gate, filter, exit rule, or live trading-path behavior changed. One new script
(`zerodte-thesis-rank-reject-real-cost-ab.mjs`), reusing (never duplicating) real production
candidate-generation/gate code and the already-fee-bug-fixed real-cost grading machinery from the
RVOL unbiased A/B.
