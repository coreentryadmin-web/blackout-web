## 2026-09-06 — [P2, correctness] Ask Largo lane rank crashes when `laneRows` absent — FIXED

> **kind:** `FINDING`

| **Status** | FIXED in PR (this branch) |
|---|---|
| **Severity** | P2 — `composeSwingPlayBrief` threw `TypeError` when `ctx.laneRows` omitted; CI verify failed on handoff PRs after #4076 shipped lane rank |
| **Root cause** | `computeLaneRank` called `laneRows.filter` without guarding null/undefined. Prior fix PRs (#4081–#4083) were closed without merge. |
| **Fix** | `(laneRows ?? []).filter(...)` + widened parameter types; test fixture supplies `laneRows: []`. |
| **Evidence** | RED on main: `play-brief.test.ts` flowSnapshot-null case throws. GREEN post-fix: play-brief + lane-rank tests pass. |
