# Swing play brief crashes when lane rows are absent

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **ID** | BO-P2-2026-09-06-lane-rows |
| **Status** | FIXED |
| **Area** | swing / Ask Largo play brief |
| **PR** | fix/swing-play-brief-lane-rows-guard |

## Symptom

`composeSwingPlayBrief` threw when `ctx.laneRows` was omitted/undefined — `laneRows.filter is not a function` inside `computeLaneRank`. CI verify failed on handoff PR #4080 (`not ok 9242`).

## Root cause

`buildIntelSections` always called `laneRankSection(play, ctx.laneRows)` after lane-rank shipped in Ask Largo v4 (#4076). The type marks `laneRows` required, but callers/tests can still pass partial contexts; `computeLaneRank` did not guard null/undefined.

## Fix

- Early-return `null` in `computeLaneRank` when `laneRows` is missing or empty.
- Widen parameter type to `HorizonPlay[] | null | undefined`.
- Restore test fixture fields (`laneRows: []`, `meridian: null`) and add regression test for absent rows.

## Validation

- `npx tsx --test src/lib/swing/play-brief.test.ts src/lib/swing/play-brief-lane-rank.test.ts` — 8/8 pass
