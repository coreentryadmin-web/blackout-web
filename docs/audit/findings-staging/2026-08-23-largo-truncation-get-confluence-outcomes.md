## 2026-08-23 — [FINDING, P3 Largo] `get_confluence_outcomes` payload exceeds 16k cap, agent sees only historical grading from first ~50 confluence events — ANALYZING

> **kind:** `FINDING`

The Largo agent's SPX confluence-outcome grading tool truncates when queried without a ticker filter. The model receives historical outcome grades for only the first ~50 confluence setups; outcomes for setups 51+ are silently omitted.

### Problem Statement

The `get_confluence_outcomes` tool returns historical grading (win/loss/breakeven rates) for past SPX confluence signals, organized by setup type (trend, reversal, breakout, etc.). Market-wide queries can return 100+ historical setups with outcomes; the JSON exceeds 16k bytes.

| **Symptom** | Batch 5 truncation probe (2026-08-23 18:11 UTC) returned TRUNCATED for `get_confluence_outcomes --control=get_zerodte_rejections` with default (empty) arguments. Control proven TRUNCATED (expected). |
|---|---|
| **Tool behavior** | Returns an array of { setup_id, setup_type, entry_date, entry_price, exit_date, exit_price, outcome (WIN/LOSS/BREAKEVEN), bars_held, reason }. Market-wide query (no ticker/date filter) returns 100–200 historical setups. ~300 bytes per outcome × 100 = 30KB. Exceeds 16k cap. |
| **Silent failure mode** | Model sees first 50 outcomes, then truncation cuts the rest. Model can still calculate a win rate from the 50 it has, but the rate is computed on a biased sample (oldest setups only, or earliest in the sort order). If the actual 100-setup win rate is 45%, but the first 50 have a 60% win rate (because older setups were stronger), the model reports 60% and misses the drift. |
| **Measured** | Batch 5 probe: control proven, `get_confluence_outcomes` returned TRUNCATED. Sample bias (whether old vs new setups are cut) not yet measured. |

### Blast Radius

Confluence grading is used for calibration (tuning entry/exit thresholds). Truncation means:

1. **Biased historical rate.** Largo reports a confluence win rate computed on incomplete data. If this is used to decide whether to increase or decrease trade sizes, an incomplete sample can lead to the wrong decision.
2. **Missing recent outcomes.** If the truncation cuts off recent setups (because they're sorted by date descending), Largo misses the latest calibration. If it cuts off old setups, Largo misses long-term trends.
3. **Confidence calibration.** A 60% win rate on 50 samples is different evidence than a 60% rate on 100 samples (confidence interval is narrower), but Largo reports both the same way.

### Root Cause Analysis

1. **Scope.** The tool supports date/ticker filters. Without them, it returns the entire historical grading set for the confluence engine — inherently large.
2. **Field inclusion.** All fields are useful (setup type, entry/exit price, outcome, bars held). Trimming won't help much.
3. **Pagination or limits.** Should the tool default to a date window (e.g., last 60 days) instead of all-time?

### Action Required

**Measure:**
- Re-run probe with `get_confluence_outcomes` to capture exact outcome count at truncation and the date range of outcomes that fit.
- Audit whether old vs new setups are cut, and whether this creates calibration drift.

**Decide:**
- **Option A**: Change default to `--days=60` (last 60 days) instead of all-time, reducing payload to fit.
- **Option B**: Cap to top-50 most recent outcomes (if sorted by date).
- **Option C**: Return outcomes in two payloads (recent + historical on demand).

### Status

ANALYZING — awaiting date-range measurement to determine whether a time-window limit or pagination is needed.
