## 2026-08-23 — [FINDING, P2 Largo] `get_nighthawk_dossier` payload exceeds 16k transport cap, agent receives incomplete board — ANALYZING

> **kind:** `FINDING`

The Largo agent's Night Hawk board dossier tool exceeds the 16,384-character transport cap. The full play-by-play dossier (entry rationale, exit rules, current marks, P&L, greeks) is truncated to ~16k characters, losing the later plays from the agent's view.

### Problem Statement

Night Hawk generates 10–20+ plays per session. The `get_nighthawk_dossier` tool returns the full state of all live plays with entry context, exit management, and current metrics. This tool truncates when probed with "ticker NVDA" (the widest single-ticker dossier).

| **Symptom** | Batch 2 truncation probe (2026-08-23 18:11 UTC) returned TRUNCATED for `get_nighthawk_dossier --control=get_zerodte_rejections`. Probe arguments were `ticker NVDA`. Control proven TRUNCATED (expected). |
|---|---|
| **Tool behavior** | Returns an array of play objects, each carrying: entry conditions, entry timestamp, current premium/greeks/P&L, exit rules, exit state, position status, edge/cortex decision, and grading context. An array of 15 plays × ~200 bytes per play ≈ 3KB base, but full entry context (flow breakdown, regime state, prior-day reference) can expand this to 5–10KB per play. |
| **Silent failure mode** | JSON truncation cuts the array mid-element or near the end, leaving invalid JSON. The model observes `[truncated]` and reports a parse error. It then answers with only the plays that fit in the first 16k chars — typically the first 5–8 plays, ranked by entry time. Plays 9+ are silently omitted from its knowledge of the board. |
| **Measured** | Batch 2 probe: control proven, `get_nighthawk_dossier` returned TRUNCATED with "ticker NVDA" args. Last visible play count and final play ID not yet measured. |

### Blast Radius

Night Hawk answers span two vectors:

1. **Board overview.** Trader asks "what's on the board?" Largo lists only the first 5–8 plays and omits 7–15. The trader sees an incomplete picture of their positions.
2. **Play-specific questions.** Trader asks about a specific play's entry reason or P&L (e.g., "why did we short IWM calls?"). If that play falls outside the first 5–8, Largo has no knowledge of it and cannot answer.

Both failures degrade trust in the system: the agent's answer is fluent but incomplete, with no signal that plays are missing.

### Root Cause Analysis

1. **Array size.** 15 plays × 500–1000 bytes per play (with full entry context) = 7.5–15KB base payload. Context and formatting push the total over 16k.
2. **Entry context depth.** Each play carries `entry_context.flow_breakdown`, `regime_state`, `prior_session_reference`, etc. Can these fields be **omitted** in the Largo payload? (They are needed for grading, but not for answering "what's on my board".)
3. **Pagination.** Should the tool return plays in batches (first 10, then next 10 on demand)?

### Action Required

**Measure and decide:**
- Re-run probe with `get_nighthawk_dossier ticker NVDA` to capture the exact last play index and last visible fields.
- Audit `entry_context` fields: which are used in Largo answers, which are only for internal grading?
- Prototype: return `get_nighthawk_dossier` with a subset of `entry_context` fields (omit regime_state, flow_breakdown if Largo doesn't use them).

### Status

ANALYZING — awaiting field audit to determine whether entry context can be pruned or if pagination is required.
