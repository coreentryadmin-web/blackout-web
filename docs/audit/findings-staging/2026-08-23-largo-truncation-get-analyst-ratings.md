## 2026-08-23 — [FINDING, P3 Largo] `get_analyst_ratings` payload exceeds 16k cap when called without ticker filter — ANALYZING

> **kind:** `FINDING`

The Largo agent's analyst ratings aggregation tool truncates when called without a ticker argument (market-wide query). The model receives only the first ~40–60 names' consensus ratings and cannot see ratings for names beyond that.

### Problem Statement

The `get_analyst_ratings` tool aggregates consensus buy/hold/sell counts and average price targets from multiple analyst sources (Refinitiv, FactSet, etc.). When called market-wide (no ticker filter), it returns ratings for 100+ names; the JSON exceeds 16k bytes.

| **Symptom** | Batch 5 truncation probe (2026-08-23 18:11 UTC) returned TRUNCATED for `get_analyst_ratings --control=get_zerodte_rejections` with default (empty) arguments. Control proven TRUNCATED (expected). |
|---|---|
| **Tool behavior** | Returns an array of { ticker, buy_count, hold_count, sell_count, avg_price_target, rating_strength, coverage_ratio }. Market-wide query (no ticker filter) returns 100+ names. ~200 bytes per name × 100 = 20KB. Exceeds 16k cap. |
| **Silent failure mode** | Model sees first 40–60 names sorted alphabetically (or by coverage), then truncation cuts the rest. Model can still answer "what's consensus on Apple?" (if AAPL is in the first 40), but cannot answer the same for names below the cutoff. |
| **Measured** | Batch 5 probe: control proven, `get_analyst_ratings` returned TRUNCATED. Exact name count at truncation not yet measured. |

### Blast Radius

Analyst ratings are a fundamental research signal. Truncation means:

1. **Incomplete consensus view.** Trader asks "what do analysts think about the tape today?" Largo lists only names A–M and skips N–Z.
2. **Query failures.** Trader asks about a specific stock's analyst rating. If that stock is beyond name 60 (unlikely for mega-caps, but plausible for mid-caps), Largo has no data and cannot answer.
3. **Coverage asymmetry.** Highly-covered names (AAPL, MSFT, NVDA) always appear in the top 40; less-covered names are invisible. Largo's answers may have a bias toward mega-cap coverage.

### Root Cause Analysis

1. **Market-wide scope.** A ticker-filtered query (e.g., `get_analyst_ratings ticker AAPL`) returns ~1 name, well under 16k. The truncation only occurs on market-wide queries.
2. **Field inclusion.** Do all names need buy/hold/sell counts + price target + strength + coverage? Could average price target alone fit more names in the cap?
3. **Sorting order.** Are names sorted by ticker (A–Z, hits the cap at Z/AA), by coverage (high-coverage names first, low-coverage names cut), or by price (hits some arbitrary boundary)?

### Action Required

**Measure:**
- Re-run probe with `get_analyst_ratings` to capture exact name count and last ticker at truncation.
- Determine sort order and whether sort order biases which names are visible.

**Decide:**
- **Option A**: Limit tool to top-N names by coverage or $-volume (most relevant for traders).
- **Option B**: Strip optional fields (price target, strength) for names beyond top-50.
- **Option C**: Return ratings in two calls (high-coverage + low-coverage) or paginate.

### Status

ANALYZING — awaiting truncation point measurement to determine whether a limit or pagination is needed.
