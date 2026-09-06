# Swing lane rank crashes when laneRows absent

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **ID** | BO-P2-2026-09-06-lane-rank |
| **Priority** | P2 |
| **Status** | FIXED |
| **PR** | fix/swing-lane-rank-null-guard |

## Symptom

`composeSwingPlayBrief` threw `Cannot read properties of undefined (reading 'filter')` when `laneRows` was omitted from context (sparse reads, unit tests, or partial resolve paths).

## Root cause

#4076 added `laneRankSection(play, ctx.laneRows)` without null-guarding `laneRows`. `computeLaneRank` called `.filter` unconditionally.

## Fix

- `computeLaneRank` / `laneRankSection` accept `laneRows | null | undefined` and return null when absent or empty.
- Test fixture for flowSnapshot-null case supplies `laneRows: []` and `meridian: null`.

## Evidence

RED on `main` @ `4c4bf5a8e`: `play-brief.test.ts` 3/4 pass. GREEN post-fix: 4/4.
