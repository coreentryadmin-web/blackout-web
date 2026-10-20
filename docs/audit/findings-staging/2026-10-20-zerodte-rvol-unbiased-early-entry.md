## 2026-10-20 — [FINDING, P2 Night Hawk 0DTE] RVOL early-entry — survivorship bias fixed, real unbiased result

> **kind:** `FINDING`

| **Status** | MEASURED (no gate/filter/exit rule changed — evidence only, per standing discipline) |
|---|---|

**Context.** Member directive: "fix the RVOL test's survivorship bias, then compare earlier-entry
candidates against the current system using only information available at each signal... keep exit
management unchanged while testing entries... show entry timing gained, net expectancy, drawdown,
sample size, and results on held-out days."

### The bias, and the fix

The prior `zerodte-rvol-early-entry-ab.mjs` started from real COMMITTED BREAKOUT plays — tickers
that ALREADY became real winners by construction — so "enter earlier, buying cheaper premium, in
a stock we already know moves favorably that day" won trivially regardless of RVOL's actual signal
value. Fixed in `zerodte-rvol-early-entry-unbiased-ab.mjs`: starts from the SAME real, unbiased
whole-market BREAKOUT/BREAKDOWN candidate pool `thesis-rank-reject-outcome-ab.mjs` already built
for a different question (`screenBreakoutMovers`/`screenBreakdownMovers`, real grouped-daily bars,
real dynamic-N cap) — every real mover a session produced, including real losers.

**A second real bug was caught while smoke-testing, before trusting any number**: the first cut
computed the disclosed per-contract fee assumption ($0.65/leg) as a % of the bare per-share quote
instead of the real $100-multiplier contract cost. On a cheap contract this let the fee swamp and
INVERT the real outcome — SKHX's real entry 0.05 → exit 0.10 (a genuine +100% TARGET hit) was
reported as a **-2500% "LOSS"** purely from this miscalculation. Fixed: dollar P&L computed first,
then converted to a % of the real dollar premium paid; re-verified the same row now correctly
shows +74% WIN net of fees.

### Method

Fixed 10:30 ET "current-system" baseline checkpoint vs. the earliest real RVOL "high"/"very_high"
signal (`computeRelativeVolume`, imported directly, PR #6287/#6289) — graded identically: ONE
historical same-day-expiry ATM contract resolved per candidate (real Polygon reference-contracts
lookup, nearest strike to spot AT THE BASELINE instant, used for BOTH legs so strike selection
never confounds the timing comparison), real NBBO entry/exit, real spread, realistic entry delay,
SAME mechanical PLAN_RULES stop/target for both legs (**exit management held fixed** — isolates
entry timing as the only variable, per the member's instruction). Falls back to an
underlying-continuation proxy when no same-day contract is resolvable, labeled `UNDERLYING_PROXY`
and never blended with `REAL_OPTION` rows. TRAIN/VALIDATION: chronological session-day split.

### Result (15 real session days, 600 real candidates screened, 220 graded)

| | TRAIN (8 days) | VALIDATION — held out (7 days) |
|---|---|---|
| **REAL_OPTION** n | 1 | 7 |
| REAL_OPTION paired delta (early − baseline) | -6.81% | +10.15%, 95% CI [-40.36%, +60.67%] |
| **UNDERLYING_PROXY** n | 107 | 92 |
| Baseline win rate | 59.8% | 47.8% |
| Early win rate | 63.6% | 62.0% |
| Baseline net expectancy | +0.65% | +0.45% |
| Early net expectancy | +0.69% | +0.69% |
| UNDERLYING_PROXY paired delta | +0.04%, CI [-0.26%, +0.34%] | +0.24%, CI [-0.06%, +0.55%] |

**REAL_OPTION basis is too thin to use (n=1/7)** — most BREAKOUT/BREAKDOWN candidates (small/mid
caps, breakdown shorts) simply have no liquid listed same-day-expiry option that day. This is a
real, disclosed market-structure constraint on how much of the whole-market BREAKOUT population
could even be traded as a 0DTE option in practice, not a methodology gap.

**UNDERLYING_PROXY basis (n=107/92, much larger) shows a consistent, same-direction improvement in
both halves**: win rate rises meaningfully (59.8%→63.6% TRAIN, 47.8%→62.0% VALIDATION) and net
expectancy is directionally higher in both. The paired-delta CI still touches zero in both halves
(narrowly, in VALIDATION: -0.06% to +0.55%) — **not yet statistically decisive**, but the
consistency of direction and magnitude across an unseen held-out half is exactly the pattern that
earns a SHADOW-mode trial, not a live change.

### What this does NOT establish

Per the member's own instruction, a 50/50-style or borderline underlying-basis result alone does
not justify a live change, and none was made. This result is PLANNED/underlying-proxy basis for the
large sample, and the REAL-cost confirmation (the part that would actually validate real net
expectancy after spread/decay/fees) remains too thin (n=8) to trust either way. **Next concrete
step: a shadow-mode trial** — compute both the baseline-time and RVOL-early-signal reads for real
live BREAKOUT candidates going forward, log both without acting on either, and accumulate real
paired outcomes (including real option fills where resolvable) until the sample is large enough to
decide — never touching the live commit/entry logic in the meantime.

### Blast radius

No gate, filter, exit rule, or live trading-path behavior changed. Two new scripts
(`zerodte-rvol-early-entry-unbiased-ab.mjs` superseding the biased `zerodte-rvol-early-entry-ab.mjs`,
which stays in the repo as a documented cautionary example per this finding and the prior round's
staged finding — not deleted, since the bug it demonstrates is itself instructive).
