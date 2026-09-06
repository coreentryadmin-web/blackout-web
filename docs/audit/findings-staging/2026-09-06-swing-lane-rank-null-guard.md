## 2026-09-06 — [P1, correctness] Ask Largo lane rank crashes when `laneRows` absent — FIXED

> **kind:** `FINDING`

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Area** | Swing Play Intelligence — lane rank (`play-brief-lane-rank.ts`) |

### Root cause

PR #4076 added `laneRankSection(play, ctx.laneRows)` to the brief intel pipeline. `computeLaneRank`
called `laneRows.filter(...)` without guarding `undefined`/`null`. Callers that compose a brief
before lane peers resolve (or unit tests omitting `laneRows`) threw
`TypeError: Cannot read properties of undefined (reading 'filter')`.

### Fix

- `computeLaneRank` / `laneRankSection` accept `laneRows | null | undefined` and treat missing as `[]`.
- Regression test: undefined/null/empty `laneRows` → `null` rank (no section).

### Evidence

- RED: `play-brief.test.ts` "flowSnapshot is null when HELIX has no recent-flow read" — 3/4 pass on main@4c4bf5a8e.
- GREEN: 7/7 play-brief* lane-rank tests + 4/4 play-brief tests post-fix.
