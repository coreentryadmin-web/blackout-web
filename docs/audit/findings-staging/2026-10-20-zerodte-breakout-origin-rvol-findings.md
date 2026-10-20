## 2026-10-20 — [FINDING, P2 Night Hawk 0DTE] BREAKOUT entry-timing lag + flow-history collection infrastructure

> **kind:** `FINDING`

| **Status** | MEASURED (no gate/threshold changed — evidence + tooling only, per standing discipline) |
|---|---|

**Context.** Member directive this round: study what a third-party trader ("Swift") catches that
Night Hawk doesn't, expand to BREAKOUT-origin setups (29/37 — later measured 76% — of real
commits), build the collection/replay process needed to grow the sample, and test earlier-entry
improvements (including the already-shipped RVOL shadow signal) using unseen data before touching
any live filter.

### New: persistent flow-history collector (`scripts/audit/zerodte-history-collect.mjs`)

Every FLOW-origin replay tool in this toolkit re-paged UW's flow-alerts API from scratch each run,
topping out after ~3 real session days at real alert volume before the page budget was spent — read
as "that's all the history there is." A direct UW probe confirmed real history exists back to at
least 2025-12-31; the ceiling was this toolkit's own page budget, not the provider. This collector
persists each COMPLETE real session day's rows to `docs/audit/history/zerodte-flow/<day>.json`,
growing across runs. A real bug was caught and fixed while building it: every invocation restarted
its `older_than` cursor from "now," so re-running added zero new days despite spending the whole
page budget — fixed with a persisted resume cursor. Grew the local store from 1 to 43 real session
days this round (2026-08-18…2026-10-16). `scripts/audit/lib/zerodte-flow-history.mjs` is the shared
read-only loader every replay tool now checks first.

### New: `zerodte-breakout-origin-report.mjs` — real committed performance + entry-timing lag

Rather than reconstructing BREAKOUT's whole-market momentum screen point-in-time (hundreds of
candidate tickers × many instants × many days — not tractable here without real risk of a NEW
look-ahead bug), this measures BREAKOUT-origin performance from real, already-computed production
history (`/api/market/zerodte/record`'s mechanical vs as-managed grades) plus a real entry-timing-
lag measurement from real minute bars.

**Committed performance (n=393 BREAKOUT-only plays, 90-day window, TRAIN/VALIDATION split):**
real-time trade management (ratchet floors/ladder trims) roughly doubles win rate and roughly
halves average loss severity vs. the naive mechanical (-50/+100) grade, consistently across both
halves — real evidence the existing exit logic is adding value and should be preserved, not
changed.

**Entry-timing lag:** first measurement (451min average lag) was itself a bug — Polygon's
minute-agg endpoint returns pre/post-market bars, inflating "minutes since open" past the entire
390-minute RTH session length. Fixed to anchor on the real 9:30 ET RTH open (the existing DST-safe
`etWallClockToUtcMs` helper, reused from `swing-cadence-gap-eval.mjs`) and restrict to RTH bars
only. **Corrected: 127min average lag, 77.7% of the day's eventual favorable move already banked
by flag time** (n=393). Attributed (code-reading, not a new live measurement): NOT the scan cadence
(`zerodte-warm` runs ~every 5min, 25x faster than the lag) — the more likely cause is that
`screenBreakoutMovers` is an inherently lagging price/volume-momentum screen; a name can only climb
the candidate pool after a meaningful chunk of its move has already printed.

### New: `scripts/audit/zerodte-skip-grade-backfill.mjs` — independent grading of the real backlog

Companion to the skip-grading throughput fix (#6301, staged separately): reuses `gradeSkippedPlay`
directly (never reimplemented) to grade real rejections the live cron hadn't reached yet. First
run: 27,586 rows graded across 14 real session days. `score_floor` (n=12,955) and
`thesis_rank_reject` (n=7,111) — ~78% of all rejections by volume — both landed at a near coin-flip
false-block rate (47.6% / 48.6%). **Caveat, prominent, not buried**: this grades on UNDERLYING
DIRECTION only (rejection rows carry no OCC, so premium P&L is never fabricated) — real option
decay/spread/entry-delay would erode a real chunk of this edge. No gate changed on this evidence.

### Corrected FLOW missed-trade rate, larger sample

Re-ran `zerodte-missed-trades-tracker.mjs` (the look-ahead-fixed tool from #6299) over a real
15-session-day window using the new local history store: missed-trade rate settles at **25.5%
(TRAIN) / 29.1% (VALIDATION)** — cross-validated within 3.6pp. This revises the earlier
3-real-day estimate (~40%) downward, which is exactly what a bigger sample is supposed to do, not
a contradiction. `score_floor` remains the dominant, broadly-indiscriminate blocker in both
halves — present in nearly every missed winner AND every correctly-avoided loser, consistent with
the backfill's much larger finding for the same gate.

### RVOL early-entry test — a real bias caught before being reported as a finding

Built `scripts/audit/zerodte-rvol-early-entry-ab.mjs` to test whether the already-shipped RVOL
shadow signal (`relative-volume.ts`, PR #6287/#6289) would let Night Hawk enter real BREAKOUT
setups earlier with better real-cost outcomes. A smoke test produced implausibly strong numbers
(+107.8%/+87.6% mean P&L delta, 100% early-leg win rate) — inspected the raw rows before trusting
it and found real **survivorship bias**: the test population is pre-conditioned on tickers that
ALREADY became real commits (known winners), so "enter earlier, buying cheaper/more-levered
premium, in a stock we already know moves favorably that day" wins by construction regardless of
whether RVOL specifically was a meaningful signal. This is exactly the "don't use the later move to
justify an entry retroactively" trap the member's own standing instructions warn against — caught
here before scaling it up into a misleadingly strong reported result. **Not run at scale.** A valid
test needs a population including RVOL-spiking tickers that did NOT go on to qualify as real
commits; proposed next step is extending the existing shadow-signal attachment to the
rejected-candidate path too (collection, not yet built).

### What this does NOT establish

No gate, filter, or threshold was changed anywhere in this round. The strongest finding (BREAKOUT
entry-timing lag) is real and substantial but not yet attributed to a specific fixable cause beyond
"the screen type is inherently lagging." The backfill and missed-trade numbers are real but
planned/underlying-basis, not yet real-cost-verified at the near-floor margin specifically (the
natural next step, mirroring `zerodte-score-floor-outcome-backtest.mjs`'s own prior methodology).
Swift's actual trade examples were never available in this session (confirmed via a filesystem
check — nothing was uploaded/attached) and were not invented.
