## 2026-10-20 — [FINDING, P2 Night Hawk 0DTE] Point-in-time gate-rejection trace + real-cost confluence backtest

> **kind:** `FINDING`

| **Status** | MEASURED (no gate/threshold changed — evidence only, per standing discipline) |
|---|---|

**Context.** Member audit directive: "show which filters rejected each setup and when, replay
the session using only information available at each alert time, and compare current rules
against proposed changes including losing setups, missed trades, spreads, and realistic entry
delays." Two gaps in the existing toolkit made this not yet answerable directly:

1. `zerodte-gate-compound-funnel.mjs` evaluates every setup against ONE shared "now" snapshot
   (one VIX read, one SPY bias, fetched once at script start) — correct for "what would the board
   show right now," but not a true point-in-time replay: a setup whose flow print landed 40
   minutes before the run started would be evaluated against 40-minutes-newer data than it could
   have seen.
2. `zerodte-confluence-floor-outcome-backtest.mjs` grades on a favorable-first UNDERLYING-
   continuation proxy, explicitly disclosed as "not exact option premium P&L" — no real spread,
   no realistic entry delay.

### New tool 1: `scripts/audit/zerodte-gate-rejection-trace.mjs`

For each setup, re-fetches SPY + its own minute bars TRUNCATED to that setup's own decision
instant (its last qualifying flow print's `alerted_at`), then runs the real `evaluateZeroDteGates`
with `nowMs` pinned to that same instant — every verdict is one the board could actually have
reached at that moment, never with foresight.

**Cannot reconstruct a specific prior run's exact population** (e.g. "those 26 setups" from an
earlier measurement) — raw historical UW flow for an arbitrary past date, replayed against the
exact code as it existed that day, isn't reachable from this sandbox. This tool is the reusable
replacement: re-run it whenever a fresh point-in-time trace is needed.

**First live run** (2026-10-19, 3-day window, 18 setups, real data): **0/18 cleared every gate at
their own decision instant.** Per-setup detail (ticker, direction, score, exact decision time,
every blocking code) is in the script's own stdout — not reproduced here since the point is the
tool, not one run's numbers. New observation this run surfaced: `vix_elevated` fired on 18/18 of
these — checked against the real VIX day-open for that date (18.37) against `VIX_ELEVATED_
THRESHOLD=17` and `VIX_ELEVATED_SCORE_FLOOR=75` (gates.ts): this is CORRECT, evidence-backed gate
behavior (the code's own comment cites "17-20 regime ran 25% WR vs 69% at 15-17"), not a bug — but
it means a VIX regime most traders would not call "elevated" (18.37, nowhere near a volatility
spike) already imposes a 75-score floor that none of these real setups (max score 65) could clear.
Worth flagging as the single most consequential, already-justified gate in this sample, not a new
problem to fix.

### New tool 2: `scripts/audit/zerodte-confluence-floor-real-cost-backtest.mjs`

Answers the SAME confirmation-count question the existing proxy backtest asks, but with REAL
option premium, REAL bid/ask spread paid on both entry and exit, and a REALISTIC entry delay
(default 90s — a disclosed, fixed stand-in for real reaction time, not a measured distribution).
Resolves each setup's real contract (ticker/strike/expiry it already carries), fetches the real
NBBO at (decision instant + delay) for entry (paying the real ask long / real bid short), walks
real minute bars applying the real -50%/+100% stop/target, and on a non-touch exit re-fetches the
real NBBO and exits at the real bid/ask (paying the spread again).

**First live run** (2026-10-20, 10-day window, 24/25 gradeable, real data):

| Confirmations | n | Win rate | Mean P&L |
|---|---|---|---|
| 0 | 6 | 16.7% | -10.0% |
| 1 | 5 | 20.0% | -3.9% |
| 2 | 13 | 53.8% | **+140.8%** (see caveat) |

**Caveat, disclosed rather than silently accepted**: the 2-confirmation mean is dominated by one
degenerate outlier (EWY, entry $0.01 → exit $0.19, a +1800% print off a penny-priced, almost
certainly illiquid/unreliable quote). Excluding it: 2-confirmation mean P&L is **~+2.5%** over
n=12 — still the best of the three tiers, same monotonic DIRECTION as the original E3 proxy
backtest (0 < 1 < 2), but the magnitude is far smaller once real costs are included.

**What this changes vs. the proxy version**: E3's original (favorable-first proxy, no costs) found
0-conf -12.5%, 1-conf 0.0% (flat), 2-conf +15.9%. This real-cost version finds 1-conf clearly
**NEGATIVE** (-3.9%), not flat — undermining gates.ts's own stated rationale for the 2026-09-08
loosening ("the 1-conf bucket measured 0.0% EV (not negative)... trades some expected edge for
volume deliberately"). Real spread + a realistic entry delay turn "flat, so an acceptable volume
trade" into "measurably negative" in this sample.

**No gate changed on this evidence** — n=5-13 per tier is small, one tier's mean is outlier-
dominated, and this is one 10-day window. This argues the 1-confirmation allowance deserves a
larger, dedicated re-check (same discipline as every other threshold question in this toolkit:
re-run as the population grows before touching `ZERODTE_CONFLUENCE_MIN`), not an immediate revert
— but it is the first REAL-cost evidence that the stated "flat, not negative" justification for
that setting may not hold once spread and delay are priced in.

### Explicitly not done here

- Did not build a similarly real-cost version of the `score_floor` or `vix_elevated` questions —
  those already have dedicated evidence (score_floor: INVERTED, already argues against loosening;
  vix_elevated: evidence-backed per the code's own cited backtest) and were not the open question
  this pass targeted.
- `ENTRY_DELAY_SEC=90` and `HOLD_MINUTES=90` are single fixed assumptions, not measured/calibrated
  figures — printed every run so they're never mistaken for validated constants.
- Stop/target touch detection is bar-close-based for the walk-forward leg (coarser than tick-by-
  tick) — disclosed in the script header.
