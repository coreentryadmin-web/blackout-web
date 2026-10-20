## 2026-10-20 — [FINDING, P2 Night Hawk 0DTE] min_dominance real-cost A/B — INCONCLUSIVE, halves disagree on direction

> **kind:** `FINDING`

| **Status** | MEASURED (no gate/filter/exit rule changed — evidence only; INCONCLUSIVE, not acted on) |
|---|---|

**Context.** Follow-up from the real Swift-vs-Night-Hawk comparison (companion finding,
`2026-10-20-swift-comparison-2026-10-19.md`): `min_dominance` (the FLOW-origin call/put
aggression-dominance evidence gate, `SETUP_MIN_DOMINANCE=0.55`, board.ts) was the single
highest-raw-count individual gate code across Swift's real gate-rejected winners that day (QQQ
16x, SPX 3x, SPY 3x) and had not been quantitatively tested this round, unlike `score_floor`/
`thesis_rank_reject`. Member directive: "Test the strongest remaining explanation and implement a
candidate improvement if the evidence supports it. Validate on unseen sessions with realistic
option spreads, slippage, fees, and losses included."

### Method

New script `zerodte-min-dominance-real-cost-ab.mjs`: walks every real ticker/direction pair's own
print instants chronologically (no look-ahead — re-derives real `deriveZeroDteSetups` on rows
truncated to each instant), classifies PASS (cleared all 4 evidence gates at any point that day)
vs REJECT_MIN_DOMINANCE (never cleared, final rejection reason specifically `min_dominance`),
grades both under real point-in-time NBBO entry/exit, the unchanged mechanical `PLAN_RULES`
stop/target exit (held fixed — isolates the evidence-gate decision as the only variable),
realistic entry delay, and the same $100-multiplier-correct fee model this round's other real-cost
scripts already fee-bug-fixed. TRAIN/VALIDATION: chronological session-day split.

**A critical, separate bug was caught and fixed while building this** (full writeup in the
companion finding `2026-10-20-flow-history-stale-dte-bug.md`): the shared `loadHistoricalFlowDays`
loader's persisted `dte` field was computed at collection time, not alert time, which silently
restricted the real candidate population to a tiny, spurious subset on any day other than the
collector's own run date. Fixed at the loader; the REJECT_MIN_DOMINANCE population grew from
2→23 (TRAIN) and 7→19 (VALIDATION) once corrected — a first, discarded run on the corrupted
population is not reported here.

### Result (40 real session days, 2026-09-09…2026-10-19, post-fix)

| | TRAIN (n=59 PASS / 23 REJECT) | VALIDATION — held out (n=60 PASS / 19 REJECT) |
|---|---|---|
| PASS: win rate / net expectancy / avg loss | 32.2% / -3.75% / -24.40% | 45.0% / -2.82% / -29.63% |
| REJECT_MIN_DOMINANCE: win rate / net expectancy / avg loss | 17.4% / -4.98% / -8.03% | 26.3% / **+2.33%** / -12.07% |
| Verdict | gate correctly separating (REJECT worse) | INSUFFICIENT DATA (n=19, 1 short of the n=20 bar) |

### Why this is reported INCONCLUSIVE, not as a finding either way

**TRAIN and VALIDATION disagree on direction.** TRAIN confirms the gate (REJECT grades worse than
PASS: -4.98% vs -3.75% net expectancy). VALIDATION — one real candidate short of the standing
n=20 trust bar — points the OTHER way: REJECT grades BETTER than PASS, and is the only one of the
four population/half cells with a positive net expectancy at all (+2.33%). Per this
investigation's own standing discipline ("never trust a TRAIN-only or inconsistent-across-halves
pattern as a finding"), this is reported as genuinely inconclusive — the disagreement itself,
this close to the trust threshold, could resolve either way with a small amount more data, which
is the natural next step rather than a conclusion drawn now.

**No candidate improvement implemented.** The evidence does not clear the bar for a gate change in
either direction. This directly answers the member's "test the strongest remaining explanation and
implement a candidate improvement if the evidence supports it" — the honest answer this round is
that it does not yet support one.

**Side observation, not this test's main question:** PASS itself (cleared evidence gates — NOT a
claim production would have committed it; many PASS rows would still be blocked downstream by
`score_floor`/`thesis_rank_reject`/VIX/etc.) shows negative net expectancy in 3 of the 4
population/half cells, consistent with this round's other findings (§C backfill, §D-corrected
missed-trade rate) that the downstream hard-gate stack is doing real, if imperfect, separating
work even where a single evidence gate's own contribution is ambiguous.

### Blast radius

No gate, filter, exit rule, or live trading-path behavior changed. One new script
(`zerodte-min-dominance-real-cost-ab.mjs`). Depends on the `zerodte-flow-history.mjs` loader fix
from the companion dte-bug finding (same PR).
