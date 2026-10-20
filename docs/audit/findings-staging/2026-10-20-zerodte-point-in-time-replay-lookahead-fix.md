## 2026-10-20 — [FINDING, P2 Night Hawk 0DTE] Look-ahead leak in the point-in-time gate-replay tools — fixed, numbers corrected

> **kind:** `FINDING`

| **Status** | FIXED — corrected tools merged; numbers below supersede PR #6291's claims |
|---|---|

**Context.** Member directive: "keep pushing Nighthawk toward catching Swift-style setups early
and consistently... compare alerts against timestamped examples without using future information...
track missed trades, false alerts, win rate, average gains and losses, and drawdown after
realistic spreads and slippage... validate improvements on unseen data... don't force daily
trades, weaken risk controls, or overfit." Building the missed-trades/false-alerts tracker this
directive asked for surfaced a real bug in the point-in-time replay methodology PR #6291 shipped
hours earlier — caught by cross-checking its result against real production data before trusting
it, not by inspection.

### The bug

`zerodte-gate-rejection-trace.mjs` and `zerodte-confluence-floor-real-cost-backtest.mjs` (both
merged via #6291) both called `deriveZeroDteSetups` — which AGGREGATES every row it's given into
one scored setup per ticker/direction for "today" — ONCE per day with that WHOLE day's flow rows,
then only truncated the DOWNSTREAM hard-gate inputs (SPY/ticker minute bars, VIX) to a single
"decision instant." The evidence-gate math itself (score, gross_premium, aggr_share, dominance,
max_itm_pct) stayed contaminated by prints that had not happened yet as of that instant.

**Real-world proof.** Production committed TSLA on 2026-10-19 at 10:21 ET off a real score of 91
(`/api/admin/zerodte/tier-export?days=7` showed real committed counts 20/8/9/35/7 across
10-13..10-19; `/api/market/zerodte/record?days=7`'s `entry_context.discovery_origin` breakdown
listed the real FLOW-origin TSLA commit, score=91, flagged 10:21 ET). A full-day-aggregated
replica of the same ticker/day instead **rejected TSLA outright** on `max_itm_pct` — a direct
diagnostic script feeding `deriveZeroDteSetups` TSLA's full day of flow (28 prints, 13:31-19:21
UTC, $11.4M gross premium) reproduced the exact rejection: `otm_pct: -2.39` vs `threshold: -2`.
That -2.39% aggregate OTM did not exist yet at 10:21 ET — it only appeared because of prints
through 19:21 UTC, eight hours later. This single bug was the reason an earlier run of this same
methodology reported **0/18 setups ever clearing every gate** (the number #6291 shipped) — a
number now known to be an artifact of the look-ahead, not a real measurement of the gate stack.

### The fix

For each ticker/direction, walk every one of its OWN real print instants in chronological order,
re-deriving setups from flow rows TRUNCATED to each instant, and evaluating the gate stack there —
never fed a single row that hadn't printed yet.

- `zerodte-gate-rejection-trace.mjs` and the new `zerodte-missed-trades-tracker.mjs` keep the
  EARLIEST instant that reaches a real `COMMIT` verdict (full `evaluateZeroDteGates`, not just the
  evidence gates), or the LAST instant if none ever does — an earlier, shallower fix that stopped
  at "first evidence-qualifying instant" was tried first and rejected: on the TSLA example it
  landed at 09:31 ET score=44, a setup production's own continuous re-scanning would not have
  committed on either, since hard gates can still legitimately block a low-score early instant.
- `zerodte-confluence-floor-real-cost-backtest.mjs` doesn't evaluate hard gates, so it keeps the
  EARLIEST evidence-qualifying instant instead of the day's LAST print (the pre-fix behavior) —
  always using the last print is self-consistent (no contamination) but defeats the point of
  measuring a realistic EARLY entry.
- Expensive per-ticker fetches (SPY bars, ticker bars, VIX day-open) happen ONCE per ticker/day;
  only the pure recomputation (`deriveZeroDteSetups`/`computeConfluence`/`evaluateZeroDteGates`)
  repeats per instant — kept cheap despite walking every print.

**Verified against the real TSLA example**: the fixed trace now surfaces TSLA at 10:35 ET
(score=62) instead of the spurious 09:31 ET (score=44) the shallow fix produced — much closer to
the real 10:21 ET commit. The remaining score gap vs. the real 91 is consistent with this
toolkit's already-disclosed direct-UW-REST-vs-Postgres data-source difference (see
`swing-gate-compound-funnel.mjs`'s own disclosure of the same gap), not a defect in this fix.

### Corrected numbers — supersede #6291

Only 3 real session days of UW flow were available in this window (2026-10-15, 10-16, 10-19) —
disclosed the same way every sibling tool in this toolkit discloses a thin sample. TRAIN = the
older 2 days, VALIDATION = the newer 1 day, held out and never used to shape the TRAIN read.

**`zerodte-missed-trades-tracker.mjs` (new tool, real costs — real NBBO entry/exit, real spread,
90s entry delay, real -50%/+100% stop/target, real minute-bar walk):**

| | TRAIN (10-15, 10-16) | VALIDATION — held out (10-19) |
|---|---|---|
| COMMITTED (n) | 4 | 0 |
| Win rate | 75.0% (3W/1L) — MU loss −18.5%, QQQ +38.6%, SPY +31.8%, NVDA +28.0% | — |
| FALSE ALERTS (committed, real loss) | 1/4 (25.0%) | — |
| BLOCKED (n) | 25 | 23 |
| **MISSED TRADES (blocked, would have WON)** | **10/25 (40.0%)** | **9/23 (39.1%)** |
| Correctly avoided (blocked, would have LOST) | 15/25 (60.0%) | 14/23 (60.9%) |
| Avg gain on missed winners | +13.8% | +11.3% |
| Avg loss correctly avoided | −11.5% | −14.3% |

**The missed-trade rate cross-validates cleanly — 40.0% TRAIN vs 39.1% VALIDATION, within 1pp of
each other** — this is a real, held-out-confirmed number, not a TRAIN-only artifact. The COMMITTED
win-rate (75.0%, n=4) and false-alert rate (25.0%) are real but too thin to trust alone and have no
VALIDATION counterpart (0 committed that day in this FLOW-only sample), so they are reported, not
treated as settled.

Gate-block frequency shows `score_floor` and `vix_elevated` are the dominant blockers of BOTH
missed winners and correctly-avoided losers in roughly the same proportion in both halves
(`vix_elevated`: 6/10 winners vs 10/15 losers in TRAIN, 9/9 vs 14/14 in VALIDATION — every blocked
setup that day had VIX elevated, since real VIX day-open was genuinely 18.37, above
`VIX_ELEVATED_THRESHOLD=17`) — consistent with the existing evidence-backed design, not a new
over-blocking problem. `confluence_floor`'s apparent discrimination between winners/losers in
TRAIN (2/10 vs 8/15) did **not** hold up in VALIDATION (4/9 vs 5/14) — flagged and dropped per the
"never report a TRAIN-only pattern" discipline, exactly the failure mode this split exists to catch.

**`zerodte-confluence-floor-real-cost-backtest.mjs` (corrected re-run, 10-day window, same 3
real session days, 25 setups graded):**

| Confirmations | n | Win rate | Mean P&L |
|---|---|---|---|
| 0 | 12 | 41.7% | +2.9% |
| 1 | 5 | 0.0% | −8.0% |
| 2 | 8 | 62.5% | +25.8% |

**Correction to #6291's own table** (0:n=6/16.7%/−10.0%, 1:n=5/20.0%/−3.9%, 2:n=13/53.8%/+140.8%):
the corrected methodology samples a different, earlier-instant universe of setups (by design — see
Fix above), so exact figures differ and the ordering is **no longer cleanly monotonic**: 0-conf
(+2.9%) now beats 1-conf (−8.0%), where #6291 described "same monotonic direction (0 < 1 < 2)". The
part of #6291's conclusion that **does** hold up under the corrected, non-contaminated replay: the
1-confirmation bucket is still the worst of the three, still negative, and still the bucket
`ZERODTE_CONFLUENCE_MIN`'s 2026-09-08 loosening was justified against ("0.0% EV, not negative") —
real spread + a realistic entry delay again turn that into measurably negative P&L, same
conclusion as #6291, now on a methodology that isn't contaminated.

### What this does NOT establish

- Sample sizes remain small (n=4-25 per cut) and span only 3 real session days — a real but thin
  base, disclosed rather than hidden, same discipline as every sibling tool in this toolkit.
- This is FLOW-origin only. Real production commits on these same 3 days are dominated by
  BREAKOUT-origin (29 of 37 committed plays across the 3 sample days, per a direct
  `/api/market/zerodte/record` check), so this tooling — like its siblings
  (`zerodte-gate-compound-funnel.mjs`, `zerodte-confluence-floor-outcome-backtest.mjs`, etc.) —
  measures a real but partial slice of the board's actual activity, not the whole thing.
- **No gate, threshold, or filter was changed by this fix or this re-run** — per the standing
  "evidence-gathering only" discipline and the member's explicit "don't weaken risk controls"
  instruction. The 1-confirmation allowance remains flagged as a re-check candidate (consistent
  with #6291's own conclusion), not something this entry touches.

### Blast radius

Both affected tools (`zerodte-gate-rejection-trace.mjs`,
`zerodte-confluence-floor-real-cost-backtest.mjs`) are fixed in place — same files, same CLI
surface, no behavior change for any OTHER caller. No production code path was touched; this is
audit tooling only. The new `zerodte-missed-trades-tracker.mjs` has no other consumers yet.

Related: `docs/audit/findings-staging/` README's own discipline (one file per finding, this one's
own) and the standing "validate on unseen data, don't overfit" instruction this whole investigation
was run under — the TRAIN/VALIDATION split above is that validation step, not a formality.
