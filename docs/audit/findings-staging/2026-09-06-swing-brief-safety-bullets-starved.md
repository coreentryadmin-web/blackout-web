# Swing brief — Break watch + Counter-thesis starved by MAX_BULLETS

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Priority** | P1 |
| **Area** | Night Hawk Swings / Ask Largo play-brief |

## Symptom

On OPEN swings with full Vector + coaching data, `tradeManagerNarrativeSection` hit `MAX_BULLETS=14` before `breakTrigger()` and `counterThesisLine()` ran — safety-critical coaching silently omitted (CTO audit #14).

## Root cause

`collectCoachingBullets` + focal-level narration can emit 14+ bullets alone; `add()` hard-capped all lines including Break watch. Counter-thesis used a separate `bullets.length < 8` hack that still dropped on rich data.

## Fix

`add(line, { reserved: true })` bypasses the cap for Break watch and Counter-thesis only.

## Evidence

`play-brief-narrative.test.ts` — rich Vector fixture asserts `>14` bullets AND Break watch + Counter-thesis present.

## RTH validation

On `/nighthawk` Swings OPEN tab during RTH, select a committed row with full Vector data — Trade manager read must include **Break watch** and **Counter-thesis** when opposing signals exist.
