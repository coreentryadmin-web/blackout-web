## 2026-09-06 — [P2, correctness] Ask Largo lane rank throws when `laneRows` is absent — FIXED

> **kind:** `FINDING`

| **Status** | FIXED in PR (this branch) |
|---|---|
| **Severity** | P2 — #4076 `laneRankSection(play, ctx.laneRows)` called `.filter()` on `laneRows` without a guard; any brief context path omitting lane rows would crash Ask Largo |
| **Root cause** | `computeLaneRank` / `laneRankSection` typed `laneRows` as required `HorizonPlay[]` but callers can pass undefined during degraded context assembly |
| **Fix** | `(laneRows ?? [])` + widened signature to `HorizonPlay[] | null | undefined`; returns null section when no peers |
| **Evidence** | Regression test `computeLaneRank: undefined laneRows does not throw`; `play-brief*.test.ts` GREEN locally |
