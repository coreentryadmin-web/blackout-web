## 2026-08-23 — [FINDING, P3 Largo] `get_screener` payload exceeds 16k cap, agent loses screener results beyond top candidates — ANALYZING

> **kind:** `FINDING`

The Largo agent's screening tool truncates when called without arguments (market-wide query). The model receives screened candidates (filtered by criteria like price range, volume, sector) for the top entries only; candidates beyond the truncation point are silently omitted.

### Problem Statement

The `get_screener` tool screens the market for equities matching specified criteria (price, volume, sector, technical patterns, fundamental filters) and returns ranked candidates. Market-wide queries (no ticker filter) return 50+ names; the JSON exceeds 16k bytes.

| **Symptom** | Batch 7b truncation probe (2026-08-23 18:24 UTC) returned TRUNCATED for `get_screener --control=get_zerodte_rejections` with default (empty) arguments. Control proven TRUNCATED (expected). |
|---|---|
| **Tool behavior** | Returns array of screened candidates with { ticker, score, reason, fundamentals, technical, volume_context }. Market-wide query returns 50–100 candidates ranked by relevance. ~200–300 bytes per candidate × 60–80 = 12–24KB. |
| **Silent failure mode** | Model sees top-ranked screener results (sorted by score/relevance), then truncation cuts the rest. Model can answer "what are the top 20 candidates?" but cannot see lower-ranked matches. |
| **Measured** | Batch 7b probe: control proven, `get_screener` returned TRUNCATED. Exact candidate count at truncation not yet measured. |

### Blast Radius

Screener results are used for discovery and trade idea ranking. Truncation means:

1. **Incomplete candidate pool.** Trader asks "show me all stocks meeting this criteria" and sees only top 30–40, missing lower-ranked matches.
2. **Ranking bias.** If sorting is by popularity/volume, truncation hides smaller-cap or less-liquid candidates that might meet technical criteria equally well.
3. **Setup missed.** A lower-ranked candidate meeting rare/specific criteria (e.g., "price breakout + unusual volume + positive earnings surprise") is invisible if it ranks outside the visible set.

### Root Cause Analysis

1. **Payload size.** 50–100 candidates × 250 bytes = 12.5–25KB inherent payload.
2. **Scope.** Market-wide screening naturally produces large result sets.
3. **Field inclusion.** Do all candidates need fundamentals + technical + context, or can lower-ranked ones be stripped to essentials?

### Action Required

**Measure:**
- Re-run probe with `get_screener` to capture exact candidate count at truncation.
- Determine sort order and whether truncation creates a bias toward mega-caps or high-volume names.

**Decide:**
- **Option A**: Limit tool to top-N candidates (e.g., top 40) to fit within cap.
- **Option B**: Return in two payloads (top 40 + next 40 on demand).
- **Option C**: Strip technical/fundamental details for candidates beyond top-30, keep only ticker + score.

### Status

ANALYZING — awaiting candidate count measurement to determine whether a limit or pagination is needed.
