## 2026-08-23 — [FINDING, P3 Largo] `get_market_oi_change` payload exceeds 16k cap, agent loses open interest changes beyond top 50 tickers — ANALYZING

> **kind:** `FINDING`

The Largo agent's market open interest change tool truncates when called without arguments (market-wide query). The model receives OI changes only for the top ~50 tickers by $-volume; changes for 51+ tickers are silently omitted.

### Problem Statement

The `get_market_oi_change` tool screens open interest changes across all US stocks and returns tickers with the largest OI swings (bullish vs bearish indicators). Market-wide queries (no ticker filter) return 100+ names; the JSON exceeds 16k bytes.

| **Symptom** | Batch 7b truncation probe (2026-08-23 18:24 UTC) returned TRUNCATED for `get_market_oi_change --control=get_zerodte_rejections` with default (empty) arguments. Control proven TRUNCATED (expected). |
|---|---|
| **Tool behavior** | Returns an array of { ticker, oi_change_pct, oi_change_absolute, change_direction, volume_context }. Market-wide query returns 100+ names. ~200 bytes per name × 100 = 20KB. Exceeds 16k cap. |
| **Silent failure mode** | Model sees first 50 names (sorted by OI change $-magnitude), then truncation cuts the rest. Model can answer "what's the biggest OI move?" for the top 50, but cannot see OI changes in the tail. |
| **Measured** | Batch 7b probe: control proven, `get_market_oi_change` returned TRUNCATED. Exact name count at truncation not yet measured. |

### Blast Radius

OI changes are a contrarian sentiment signal (large OI increase = positioning shift). Truncation means:

1. **Incomplete tail.** Trader asks "what OI movers are worth watching today?" Largo lists only top 50 and omits potential opportunities in names 51–100.
2. **Sentiment bias.** Top OI movers are usually mega-caps and popular names; truncation hides OI swings in less-liquid names where a move can be more significant.
3. **Setup missed.** A mid-cap with a 200% OI increase (potential setup) is invisible if it ranks 60th overall.

### Root Cause Analysis

1. **Payload size.** 100 names × 200 bytes = inherent large payload. Reducing this requires fewer names or fewer fields.
2. **Scope.** Market-wide (no filter) naturally produces a large result set.
3. **Field inclusion.** Do all names need volume context, or just OI change + direction?

### Action Required

**Measure:**
- Re-run probe with `get_market_oi_change` to capture exact name count at truncation.
- Determine sort order and whether truncation creates a bias toward mega-caps.

**Decide:**
- **Option A**: Limit tool to top-50 names by OI change (fits within cap).
- **Option B**: Return in two payloads (top 50 + 51–100 on demand).
- **Option C**: Strip volume context for names beyond top-30.

### Status

ANALYZING — awaiting name count measurement to determine whether a limit or pagination is needed.
