> **kind:** `FINDING`

## `score_floor` (G-3/G-17) outcome re-check ESCALATED from `SPREAD WITHOUT ORDER` to `INVERTED` (ρ = −1) after fixing the backtest's stale bucket split

| | |
|---|---|
| **Area** | 0DTE — score-floor calibration evidence (`ZERODTE_SCORE_FLOOR`/`ZERODTE_SINGLE_RAIL_PRIME_MIN`, gates.ts G-3/G-17) |
| **Severity** | P2 (evidence-only; the single most concerning outcome-ranking result in this toolkit to date, but n is still thin at the two bands nearest the live admission boundary) |
| **Status** | OPEN — reported per the standing escalation policy (a calibration/threshold question needing a larger-N re-run and a real-premium re-derivation, not a mechanical one-line fix); no gate/threshold changed in this PR. |

### What changed

While executing today's 0DTE gate-floor deep-dive audit's TOP-3 item #2 (re-run
`zerodte-score-floor-outcome-backtest.mjs` with buckets split to match G-17's real 2026-09-09
restructure — see the sibling `fix(zerodte): split score-floor buckets...` PR that ships the
tooling fix this finding's numbers came from), the re-run's verdict escalated:

| Run | Sessions | n (graded) | Spread | ρ | Verdict |
|---|---|---|---|---|---|
| 2026-09-10 (merged 65-74 bucket) | 18 | 392 | 11.1pp | −0.20 | `SPREAD WITHOUT ORDER` |
| 2026-09-17 (split 65-69/70-74) | 28 | 436 | 10.7pp | **−1** | **`INVERTED`** |

Among the four bands with n≥30 (0-39 n=60, 40-54 n=223, 55-64 n=88, 65-69 n=49), win rate falls
**monotonically** as score rises: 25.0% → 23.3% → 20.5% → 14.3%. Perfect negative rank correlation
across a real, well-powered sample (every included band n≥49) — the cleanest, strongest signal any
score-outcome check in this toolkit has produced (contrast: `helix-score-signal.mjs`'s own analogous
check on HELIX's conviction score found `SPREAD WITHOUT ORDER`, never `INVERTED`).

Two further checks, both thin (n<30, excluded from the ρ calculation, reported as directional
signal only):
- **Headline comparison** (55-64 blocked vs. 70-74, the band G-17 actually admits today):
  70-74 graded 7.7% (n=13) vs. 55-64's 20.5% (n=88) — a −12.8pp delta against the floor's implied
  ordering.
- **G-17's own band-split rationale** (2026-09-09 restructure comment: "a genuinely well-confirmed
  70-74 setup should NOT be equally weak EV as an unconfirmed 65-69 one"): 70-74 graded 7.7% vs.
  65-69's 14.3% — the OPPOSITE of that rationale, a further −6.6pp in the wrong direction.

### Why this is being reported, not fixed

Per this repo's own single-sample-caution and n≥30 discipline (used throughout this toolkit): the
two bands nearest the actual live admission boundary (70-74, 75-84) are both n<30 and were
correctly excluded from the ρ/spread calculation — so this does **not** by itself prove the 70-74
conditional-admission path is broken. What it DOES show, on a well-powered sample the discipline
doesn't need to caveat, is that the broader trend across four real bands (n=49 to n=223) now runs
backwards from what the floor assumes — more cleanly than the 2026-09-10 run found, not less. Same
scope limits as that prior run apply unchanged: this measures a favorable-first
underlying-continuation proxy (not real option premium P&L) and `score` alone (not jointly gated
with VIX/confluence/governor/Cortex).

### Recommended next steps (not done here — reporting only)

1. Grow the 70-74/75-84 samples past n=30 (re-run again as more sessions accumulate post-2026-09-09)
   before treating the headline/band-split comparisons as more than directional.
2. The standing open item from the 2026-09-10 entry is now more urgent, not less: a real-premium
   re-run of F-2's original methodology (`NIGHTHAWK-0DTE-DECISION.md`, 2026-07-13) at today's larger
   achievable sample size — this backtest's own proxy-vs-premium scope limit means an INVERTED
   underlying-continuation ranking is necessary evidence of a problem, not sufficient evidence that
   real option P&L is also inverted.
3. Do not touch `ZERODTE_SCORE_FLOOR`/`ZERODTE_SINGLE_RAIL_PRIME_MIN` on this evidence alone — but
   this is now the strongest single data point in the toolkit arguing the score formula (not just
   the floor's specific cutoff) may be underscoring or mis-ranking tradeable setups, and deserves a
   fast follow-up rather than sitting for another 8 weeks the way the 2026-09-10 run did.

### Update 2026-09-17 (same day) — entry-time follow-up: partially resolves, but not the G-17-specific comparison

The confluence-floor sibling check (built the same day) found its own INVERTED verdict was an
artifact of grading from a mistimed 10:00 ET entry rather than E3's own 11:00 ET — re-running this
score-floor backtest with `--entry=11:00` on the identical 28-session population tests whether the
same explanation applies here.

| | @10:00 ET | @11:00 ET |
|---|---|---|
| Overall verdict (n≥30 bands) | `INVERTED`, ρ=−1 | `SPREAD WITHOUT ORDER`, ρ=0 |
| Cross-floor (55-64 blocked vs. 70-74 admitted, both n=13/88) | −12.8pp | **−3.7pp** (narrows) |
| G-17 band-split (70-74 vs. 65-69, n=13/49) | −6.6pp | **−14.8pp** (widens) |

**Partial answer, in two directions:**
- The **overall clean monotonic inversion does NOT survive** at the correct entry time (same
  finding shape as confluence-floor) — real evidence the original `INVERTED` verdict was at least
  partly inflated by mistimed-entry grading, not proof the score formula itself ranks backwards.
- The **G-17-specific 70-74-vs-65-69 comparison is NOT explained away** — it gets WORSE at the
  correct entry time (−14.8pp vs −6.6pp), the opposite of what a pure timing-artifact explanation
  would predict. This specific comparison remains the standing concern and should NOT be
  down-weighted just because the broader trend resolved.

**Status stays OPEN, no gate changed.** Recommended next step is narrower now than step 2 above:
prioritize the real-premium re-run specifically on the 70-74-vs-65-69 comparison (G-17's own stated
rationale for treating them differently) rather than the whole score band sweep, since that is the
part entry-time correction did not resolve.

### Evidence

Full run detail, both the 2026-09-10 and 2026-09-17 (10:00 and 11:00 ET) numbers side by side:
`docs/audit/0DTE-RESEARCH.md`, E6 section ("does `score_floor` (65) actually rank forward outcome?").
