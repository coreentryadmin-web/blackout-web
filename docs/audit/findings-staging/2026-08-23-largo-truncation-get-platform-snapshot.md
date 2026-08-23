## 2026-08-23 — [FINDING, P3 Largo] `get_platform_snapshot` payload exceeds 16k cap, agent loses platform state beyond first entries — ANALYZING

> **kind:** `FINDING`

The Largo agent's platform state snapshot tool truncates when called without arguments (full platform query). The model receives platform-wide state (active sessions, desk panels, member activity, market conditions) for a partial set; state beyond the truncation point is silently omitted.

### Problem Statement

The `get_platform_snapshot` tool captures a cross-product platform state snapshot including active sessions, desk composition, member activity levels, and system health indicators. Full-platform queries (no filter) return comprehensive state; the JSON exceeds 16k bytes.

| **Symptom** | Batch 7b truncation probe (2026-08-23 18:24 UTC) returned TRUNCATED for `get_platform_snapshot --control=get_zerodte_rejections` with default (empty) arguments. Control proven TRUNCATED (expected). |
|---|---|
| **Tool behavior** | Returns object with active sessions, desk states, member activity, and platform health. Full snapshot includes all desk lanes + all active members. ~1KB per active member × 15–20 members = 15–20KB. |
| **Silent failure mode** | Model sees initial active members/sessions, then truncation cuts the rest. Model can answer "is anyone on the Night Hawk desk?" for visible members but cannot see complete roster. |
| **Measured** | Batch 7b probe: control proven, `get_platform_snapshot` returned TRUNCATED. Exact member/session count at truncation not yet measured. |

### Blast Radius

Platform state is used for context-aware advice (e.g., "many members are in Night Hawk; focus on 0DTE plays") and system-health reasoning. Truncation means:

1. **Incomplete activity roster.** Agent asks "how many members are active?" and sees partial roster, missing late entries.
2. **Missing desk composition.** A truncated snapshot hides which desks are active and how populated they are, affecting what plays or strategies to recommend.
3. **Stale context.** Recommendations about "current member interest" are based on partial data, potentially misrepresenting platform engagement.

### Root Cause Analysis

1. **Scope.** A full platform snapshot naturally includes many concurrent sessions and members.
2. **Field inclusion.** Do all members need full activity history, or just current status + timestamp?
3. **Pagination or filtering.** Should the tool default to active-only members, or return all concurrent sessions?

### Action Required

**Measure:**
- Re-run probe with `get_platform_snapshot` to capture exact member/session count at truncation.
- Determine which fields are in the truncated tail (activity history vs. current state).

**Decide:**
- **Option A**: Limit to active members only (most relevant for agent context).
- **Option B**: Return in two payloads (active members + session roster on demand).
- **Option C**: Strip historical activity for peripheral members, keep only current status.

### Status

ANALYZING — awaiting member/session count measurement to determine whether a limit or pagination is needed.
