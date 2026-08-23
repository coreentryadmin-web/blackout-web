## 2026-08-23 — [FINDING, P2 Largo] `get_banger_board` payload exceeds 16k cap, agent sees only top 10–15 bangers of 100+ — ANALYZING

> **kind:** `FINDING`

The Largo agent's whole-market banger discovery board tool returns all candidates (100–150+ names ranked by $-volume) in a single payload that exceeds 16k characters. Only the first 10–15 names survive the truncation; later candidates are silently omitted from the agent's view.

### Problem Statement

The `get_banger_board` tool screens the entire US stock universe (~12.4k names daily) and returns the highest $-volume breakout candidates with their GEX/greeks/flow context. A full run produces 100–150 candidates. Packed into JSON with all context, this exceeds 16k bytes.

| **Symptom** | Batch 2 truncation probe (2026-08-23 18:11 UTC) returned TRUNCATED for `get_banger_board --control=get_zerodte_rejections`. No arguments (tool uses its default date/discovery parameters). Control proven TRUNCATED (expected). |
|---|---|
| **Tool behavior** | Returns an array of 100–150 banger objects, each carrying: ticker, gain%, volume, GEX direction, greek exposure, flow anomaly flag, liquidity metrics, and recommended OTM call strike. JSON serialization of all fields ≈ 300–500 bytes per name. 100 names × 400 bytes = 40KB, but with context and structure overhead, it lands at 35–50KB. The 16k cap cuts this to the first ~40 names at full fidelity, or top 10–15 if the early candidates have rich context. |
| **Silent failure mode** | JSON truncation cuts the array mid-element. The model observes `[truncated]` and parse error, then answers with only the names it received. A trader asking "what are the best bangers today?" gets told about names 1–10 and nothing else. Names 11–100, including potentially strong opportunities, are invisible to Largo. |
| **Measured** | Batch 2 probe: control proven, `get_banger_board` returned TRUNCATED. Exact breakoff point (how many candidates fit) not yet measured. |

### Blast Radius

Banger discovery is a whole-market scan. Truncation means:

1. **Incomplete top-N.** Trader asks for "top 5 opportunities." Largo lists them from the 5 that fit in 16k, which may be weaker than candidates 6–50 that were dropped.
2. **Silent rank inversion.** Candidates are ranked by $-volume (biggest movers/most liquidity). Truncation preserves rank order but cuts the tail, so the model always sees a valid top-N, but not the **actual** top-N if more than 40 qualify.
3. **Missed opportunities.** A strong setup in candidate #45 is invisible.

### Root Cause Analysis

1. **Payload size.** 100 candidates × 400 bytes per candidate = inherent large payload. Reducing this requires either fewer candidates or fewer fields per candidate.
2. **Field inclusion.** Do all candidates need full GEX/greek/flow context, or just a summary (gain%, volume, strike)? Largo may only use the top 5–10 anyway.
3. **Pagination or limit.** Should the tool return only top-N (e.g., top 40) instead of 100+?

### Action Required

**Measure first:**
- Re-run probe with `get_banger_board` to capture exact candidate count at truncation point.
- Audit which fields Largo actually uses in answers (do all candidates need GEX, or just the top 10?).

**Then decide:**
- **Option A**: Limit tool to top-40 candidates (fits within cap).
- **Option B**: Return candidates in two payloads (top 50 + beyond top 50, agent requests both).
- **Option C**: Strip non-essential fields (liquidity metrics, flow anomaly flags) for candidates beyond top-20.

### Status

ANALYZING — awaiting candidate count measurement to determine whether a simple limit or pagination is required.
