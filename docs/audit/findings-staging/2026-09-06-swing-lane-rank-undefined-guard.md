## 2026-09-06 — [P2, correctness] Ask Largo lane rank crashes when `laneRows` absent — FIXED

> **kind:** `FINDING`

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Area** | Swing Play Intelligence — lane rank (`play-brief-lane-rank.ts`) |

### Root cause

PR #4076 added `laneRankSection(play, ctx.laneRows)` to the brief intel pipeline. `computeLaneRank`
called `laneRows.filter(...)` without guarding `undefined`/`null`. Unit tests that compose a brief
without `laneRows` (or any caller where resolve hasn't populated peers yet) threw
`TypeError: Cannot read properties of undefined (reading 'filter')`.

### Fix

- `computeLaneRank` / `laneRankSection` accept `laneRows | null | undefined` and treat missing as `[]`.
- Test fixture for flowSnapshot null-case now includes required `laneRows: []` + `meridian: null`.
- Regression test: undefined/null/empty `laneRows` → `null` rank (no section).

### Evidence

- RED: `play-brief.test.ts` "flowSnapshot is null when HELIX has no recent-flow read" — 16/17 pass.
- GREEN: 17/17 play-brief* tests pass post-fix.
