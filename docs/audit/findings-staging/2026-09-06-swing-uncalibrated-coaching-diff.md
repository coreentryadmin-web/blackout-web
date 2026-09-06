> **kind:** FINDING

## Swing play-brief: uncalibrated thesis health still narrated in coaching + diff — FIXED

| Field | Value |
|-------|-------|
| **ID** | BO-P1-LARGO-002 |
| **Area** | Night Hawk Swings / Ask Largo |
| **Status** | FIXED (pending merge) |

### Root cause

#4318 correctly withheld the aggregate thesis-health `%` from the Thesis health section and surfaced `thesis health` in `unavailableSources`, but three downstream paths still treated the bogus ~46% band as calibrated signal:

1. `thesisBreakCoaching()` — emitted `**Thesis WARN**` from `thesisBreakLevel` on uncalibrated rows.
2. `thesisPillarCoaching()` — emitted `**What moved** — Persistence: unknown → unknown` from default pillar labels.
3. `snapshotFromBrief()` / `diffBriefSnapshots()` — narrated `**Thesis improving** — health moved +6 pts to 52%` on refresh.

### Fix

- Guard `thesisBreakCoaching` and `thesisPillarCoaching` with `thesisHealthUncalibrated()` (same guard used in `actionNarrative` / `holdPlanSection`).
- Omit `thesisHealth` from diff snapshots when uncalibrated so the diff engine cannot narrate % shifts.

### Evidence

- `npx tsx --test src/lib/swing/play-brief-narrative-coaching.test.ts` — uncalibrated coaching silence tests GREEN.
- `npx tsx --test src/lib/swing/play-brief-diff.test.ts` — uncalibrated diff omission test GREEN.
