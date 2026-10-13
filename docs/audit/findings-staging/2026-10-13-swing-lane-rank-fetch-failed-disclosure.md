## 2026-10-13 — [FINDING, P3 swing/Ask Largo, data-honesty] Swing play-brief's "Lane rank" section vanished on a transient fetch failure with no disclosure, indistinguishable from an honestly-thin lane — fix/swing-lane-rank-fetch-failed-disclosure (#5947)

> **kind:** `FINDING`

### What was broken

Ask Largo standing-mandate deep-dive, continuing PR #4076 comment 6116699649 (2026-10-12, live
repro `SWING_AMD:51`): two reads of the identical live position, minutes apart, returned 18 vs 13
sections — "Lane rank" (among others) silently vanished, with `unavailableSources` byte-identical
across both reads (nothing explained the gap). The live member board
(`GET /api/market/nighthawk/horizons?view=swings`) showed 145 real peers at the same instant this
play's own independent lane-rows read came back empty.

### Root cause

`loadLaneRows()` (`src/lib/swing/play-brief-resolve.ts`) calls `getSwingServingLane(...).catch(() =>
null)` and returns `rows: []` whenever that call rejects OR resolves with no sections — a genuine
fetch failure and a legitimately-thin lane (fewer than 2 real peers today) were indistinguishable
from the outside. `laneRankSection`/`computeLaneRank` (`play-brief-lane-rank.ts`) already render
`null` on `peers.length < 2` with no disclosure chip at all — unlike the sibling GEX/Vector-desk-state
absences in `play-brief-absence.ts`, which already carry a chip for their own top-level null case.

### Fix

`loadLaneRows()` now returns a `fetchFailed: boolean` (true only when the underlying `.catch(() =>
null)` actually fired — a real throw, never a legitimately-cold/thin lane). Threaded as
`laneRowsFetchFailed` through `resolveSwingPlayForBrief()`'s 7 return points, `SwingPlayBriefContext`,
and a new `collectBriefUnavailableSources` chip (`"Lane rank" / "swing serving-lane snapshot
unavailable"`), gated identically to every sibling absence chip (`!isNotLive` — a closed play never
re-derives a live lane rank). Additive only — no gate/score/ranking logic touched.

### Evidence

- 2 new regression tests (`play-brief-absence.test.ts`): `laneRowsFetchFailed: true` surfaces the new
  chip; a genuinely-thin lane (`laneRowsFetchFailed: undefined`) does not.
- `npx tsc --noEmit` clean.

| **Status** | FIXED — PR #5947 |
