> **kind:** `FINDING`

## `tier-exit-mode-ab.mjs`'s C-tier/untiered ratchet-vs-trim_scale ordering REVERSED on a fresh re-run — re-opening a question this repo had treated as settled

| | |
|---|---|
| **Area** | 0DTE — exit management (`resolveExitModeForTier`, `exit-sync.ts`) |
| **Severity** | P2 (evidence-only reversal; no live gate/threshold is wrong today, but the recommendation this repo shipped on is no longer supported by fresh data) |
| **Status** | OPEN — reported per the standing escalation policy (a calibration/live-picks question needing more data, not a mechanical one-line fix); no code changed in this PR. |

### What changed

`scripts/audit/tier-exit-mode-ab.mjs` (Task #59, `docs/audit/0DTE-RESEARCH.md`) re-grades the
C-tier/untiered 0DTE population under both the shipped `ratchet` exit and the default-off
`trim_scale` exit, using the same shipped `evaluateExitState`/`TRIM_SCALE_RULES` the board actually
runs. Its **first live run (2026-08-29, 90-day window, n=99 graded, population=111)** found ratchet
clearly ahead on both metrics — 45.5% WR / +5.5% avg P&L vs. trim_scale's 38.4% WR / −7.3% avg
P&L — and recommended **leaving the shipped ratchet default as-is**. That recommendation has sat
unrevisited in `docs/audit/0DTE-RESEARCH.md` since.

A fresh re-run today (2026-09-17, same 90-day window mechanics, n=100 graded, population=115 — 4
rows failed bar-repricing) shows the **opposite ordering on win rate**:

| | ratchet | trim_scale |
|---|---|---|
| 2026-08-29 (n=99) | 45.5% WR / **+5.5%** avg P&L | 38.4% WR / −7.3% avg P&L |
| 2026-09-17 (n=100) | **31.0%** WR / **−7.0%** avg P&L | 38.0% WR / −7.7% avg P&L |

- Win-rate gap flipped sign: ratchet was +7.1pp ahead, trim_scale is now **+7.0pp ahead**.
- The avg-P&L gap that was the main justification for keeping ratchet (+12.8pp in its favor)
  collapsed to a statistically negligible **+0.7pp**.
- Visible driver in `by_outcome`: ratchet reached a true `doubled` close on only 12/100 rows this
  run (vs. 29/100 for trim_scale banking a partial via `runner_close`), with 35/100 rows exiting
  via the trailing-stop `ratchet` close instead of doubling — ratchet gave back more peak gain in
  the newer population than it did in the August sample.

### Why this is being reported, not fixed

Per this repo's own single-sample-caution discipline (used everywhere in this toolkit —
`cortex-oppose-magnitude-ab.mjs`, `swing-score-calibration.mjs`, etc.): n=100 per arm with an
avg-P&L gap that's now within noise is not conclusively separable from the reverse ordering
either. **Do not flip `resolveExitModeForTier`'s shipped default on this evidence alone.** The
actual defect this finding reports is procedural, not a wrong gate: the 2026-08-29 "leave ratchet
as-is" recommendation was written up as if settled and has been cited (implicitly, by omission of
any follow-up) as current for three weeks, while a single additional data point already reverses
its headline conclusion — exactly the kind of drift `docs/audit/0DTE-RESEARCH.md`'s own "Task #59"
entry should have flagged for periodic re-check and didn't.

### What was checked

- The 90-day trailing window rolled ~19 days of June/July trades off and ~19 days of Aug/Sep
  trades on between the two runs — a plausible, undiagnosed driver (regime shift vs. genuine
  noise), not yet isolated.
- `tier-exit-mode-ab.mjs` itself has no confidence interval / bootstrap on its win-rate or avg-P&L
  deltas, so today's run cannot itself state whether n=100 separates either ordering from chance.

### Recommended next steps (not done here — reporting only)

1. Re-run again in a few more weeks; if the reversal holds or deepens, that's a real trend, not
   noise from population turnover.
2. Add a confidence interval / bootstrap to `tier-exit-mode-ab.mjs` so a future run can state
   separability directly instead of eyeballing point estimates.
3. If a third run confirms trim_scale ahead, that becomes the actionable trigger to flip
   `resolveExitModeForTier`'s C-tier/untiered default — not this one.

### Evidence

Full run comparison and every other tool's live re-check from the same sweep:
`docs/audit/0DTE-RESEARCH.md` (Task #59 section, append the 2026-09-17 numbers above under the
existing entry rather than replacing it, per that doc's own "keep updated as measurements run"
convention).
