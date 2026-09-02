# Deep mode "Bottom line" prompt compliance violation

> **kind:** `FINDING`

| Field | Detail |
|---|---|
| **Status** | FIXED in `claude/largo-53p3kg` |
| **Severity** | P3 — wasted tokens/latency, no functional break |
| **Surface** | `src/lib/largo/largo-depth.ts` Deep-mode prompt block (line 212) |

## Root cause

The Deep-mode prompt explicitly states: **"Do NOT write a 'Bottom line' section. It is dropped before render — every character of it is wasted."**

However, the model is repeatedly writing `**Bottom line:**` sections anyway, which are dropped completely by the terminal before render (see `src/lib/largo/deep.ts` parsing logic that has no Bottom-line handler).

**Result**: Every occurrence wastes:
- Generation tokens (directly increases latency)
- Member-facing latency (no content to show)
- Character budget (pushed against length limits)

Confirmed in at least one live answer via coordinator's breadth probe (Q5 in production).

## Why it matters

This is a **prompt-compliance gap**, not a contract violation — the model is choosing to violate a stated constraint. The instruction exists but is not emphatic enough for the model to reliably follow.

Impact is purely efficiency (token waste + latency), not correctness. But for every answer that includes a wasted Bottom-line section, the member pays latency with nothing to show for it.

## Fix

Made the instruction more forceful and explicit about token cost:

```typescript
**⛔ CRITICAL: Do NOT write a "Bottom line" section under any circumstances.** It is DROPPED
COMPLETELY before render — 100% of characters in "Bottom line" are wasted token cost + latency
with zero benefit to the member. Your **Verdict** already is the final takeaway. Do not repeat it.
```

Changes from soft ("not as...") to hard (⛔ CRITICAL) warning with explicit token/latency impact framing.

## Testing

Run production queries and grep persisted answers for `"Bottom line"` at deep depth to measure:
- How often does the violation occur in real traffic?
- Did the more forceful prompt reduce the rate?
- If still occurring, may need different approach (e.g. post-generation strip, or different framing)

## Blast radius

Only affects Deep-mode answer generation. No parsing logic or structure changes. Worst case: model continues to write Bottom-line sections and they continue to be dropped (behavior unchanged).

## Related findings

- Mid-sentence truncation (max_tokens, separate issue with detection now added)
- Response length investigation (operator's QA protocol goal)
