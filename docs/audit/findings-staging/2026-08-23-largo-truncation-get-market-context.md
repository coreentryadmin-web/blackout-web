## 2026-08-23 — [FINDING, P2 Largo] `get_market_context` payload exceeds 16k transport cap, agent receives incomplete board state — ANALYZING

> **kind:** `FINDING`

The Largo agent's cross-product market context tool exceeds the 16,384-character `MAX_TOOL_RESULT_CHARS` transport cap. The model observes `…[truncated]` marker and receives only the first ~16k characters of the JSON payload; key-order truncation means early fields (product status) survive while later summaries (market sentiment, indices) are silently dropped.

### Problem Statement

Largo must answer trader questions that span six products (Helix, Thermal, Vector, Meridian, Night Hawk, SPX). The `get_market_context` tool aggregates state from all six into a unified payload so the model can see "what changed and why" across the whole desk. This tool truncates.

| **Symptom** | `largo-truncation-probe.mjs` batch 1 run on 2026-08-23 18:11 UTC returned TRUNCATED verdict for `get_market_context` with control tool `get_zerodte_rejections` proven (TRUNCATED as expected). Probe used live production Largo instance at `https://blackouttrades.com`, authenticating as temp admin user. |
|---|---|
| **Tool behavior** | The tool returns a merged object: `{ helix: {...}, thermal: {...}, vector: {...}, meridian: {...}, nighthawk: {...}, spx: {...}, summary: {...} }`. JSON serialization of this object exceeds 16k bytes. Transport cap applies at `src/lib/largo/anthropicToolLoop.ts` line ~68: `tool_result: raw.slice(0, MAX_TOOL_RESULT_CHARS)`. |
| **Silent failure mode** | The JSON is valid JSON (the truncation cuts off mid-value or mid-array, leaving invalid JSON that the model cannot parse). But `parseToolResult` in `anthropicToolLoop.ts` wraps the result in a try-catch that reports parsing errors as `raw_error` fields, which the model observes. So the truncation is NOT silent — the model sees `[truncated]` and a parse error. It can still fluently answer the question if the early fields (product indicators) are enough, but it lacks the later context (summary, indices) that would make the answer complete. |
| **Measured** | Batch 1 probe: control proven, `get_market_context` returned TRUNCATED. Last visible key in the payload (before truncation) is not yet measured — see Action. |

### Blast Radius

Cross-product questions rely on this tool. Any question asking "what changed across the board" or "compare these products" may receive an incomplete picture. The agent may omit or rank changes incorrectly because it never saw the later fields of the payload.

**Cross-product trade-offs:**
- Helix answers: unaffected (Helix has its own `get_helix_*` tools and Largo uses those first; `get_market_context` is a secondary fallback).
- Thermal answers: at risk (Thermal has `get_thermal_compare` but only for single-ticker; board-wide state may rely on `get_market_context`).
- Vector/SPX/Night Hawk: cross-product questions at risk.

### Root Cause Analysis (In Progress)

Three plausible causes, measured in priority order:

1. **Payload aggregation design.** Six products × N fields each = a large merged object. Consider whether the tool should return **per-product** payloads separately (so the model gets Helix + Thermal separately, each under its own cap) or **paginate** the aggregation (summary fields in a second call).

2. **Field inclusion.** Does the payload include fields the model doesn't need? (e.g., raw greeks/flow from every product when a summary suffices). Audit which fields from each product are actually used in Largo answers.

3. **JSON structure.** Are there inefficiencies in how the object is shaped? (e.g., redundant nesting, fields that could be omitted). A 5% structure optimization (removing redundant fields, flattening) might drop it under cap.

### Action Required

**Measure first, design second:**
- **IMMEDIATE**: Re-run `largo-truncation-probe.mjs --tools=get_market_context --json` to capture the exact last_key (the last field that survives the truncation). This tells us what the model actually receives.
- **THEN**: Decide between per-product payloads vs pagination vs field audit, based on the last_key and the model's actual answer quality with the truncated payload.

**Do NOT immediately patch** — a per-tool band-aid (try to reduce JSON size) costs more than fixing the systemic cap (see architecture audit, §7 of certification mandate). If many tools truncate, this is an architectural constraint, not a per-tool bug.

### Status

ANALYZING — awaiting last_key measurement and field audit to determine root cause.
