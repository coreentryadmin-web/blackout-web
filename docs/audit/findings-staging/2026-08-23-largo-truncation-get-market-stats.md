## 2026-08-23 — [FINDING, P3 Largo] `get_market_stats` payload exceeds 16k cap, agent loses market aggregates beyond top entries — ANALYZING

> **kind:** `FINDING`

The Largo agent's market statistics aggregation tool truncates when called without arguments (market-wide query). The model receives market statistics (highs, lows, volume, breadth) for a subset of the result set; statistics beyond the truncation point are silently omitted.

### Problem Statement

The `get_market_stats` tool aggregates market-wide statistics across indices and breadth metrics, returning market-level summaries and moving averages. Market-wide queries (no ticker filter) return large result sets; the JSON exceeds 16k bytes.

| **Symptom** | Batch 7b truncation probe (2026-08-23 18:24 UTC) returned TRUNCATED for `get_market_stats --control=get_zerodte_rejections` with default (empty) arguments. Control proven TRUNCATED (expected). |
|---|---|
| **Tool behavior** | Returns aggregated market statistics including indices, breadth data, volume summaries, and moving averages. Market-wide query returns large structured data. Payload reaches 16–20KB. |
| **Silent failure mode** | Model sees initial statistics entries, then truncation cuts the rest. Model can answer "what's the market breadth?" for visible entries but cannot see complete statistics in the tail. |
| **Measured** | Batch 7b probe: control proven, `get_market_stats` returned TRUNCATED. Exact field count at truncation not yet measured. |

### Blast Radius

Market statistics are used for regime detection and breadth-based sentiment signals. Truncation means:

1. **Incomplete breadth picture.** Trader asks "is this rally broadbased?" Largo sees partial breadth data and makes a judgment on incomplete information.
2. **Missing regime context.** A complete set of indices + breadth metrics + volume context is needed to classify market regime. Truncation hides tail entries.
3. **Stale aggregates.** Moving averages and breadth indicators require the full dataset to be meaningful; partial results can misrepresent the signal.

### Root Cause Analysis

1. **Payload size.** Large structured aggregates over multiple indices and timeframes naturally produce a large result set.
2. **Field inclusion.** Do all statistics need all moving averages, or can they be stripped for entries beyond a threshold?
3. **Aggregation scope.** Should the tool default to top-tier indices only, or paginate broader datasets?

### Action Required

**Measure:**
- Re-run probe with `get_market_stats` to capture exact field count at truncation.
- Determine whether truncation creates a bias toward certain index types or timeframes.

**Decide:**
- **Option A**: Limit tool to top-tier indices only (fits within cap).
- **Option B**: Return statistics in two payloads (core indices + extended).
- **Option C**: Strip less-critical moving averages for peripheral entries.

### Status

ANALYZING — awaiting field count measurement to determine whether a limit or pagination is needed.
