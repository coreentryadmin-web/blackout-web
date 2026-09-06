# Largo C2 — vexCoaching missing stale Vector gate

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Severity** | P2 |
| **Area** | Night Hawk Swings / Ask Largo play-brief |
| **PR** | (this branch) |

## Symptom

`vexCoaching()` could narrate vanna flip / VEX wall levels from a stale Vector snapshot while sibling coaches (`technicalsCoaching`, `vectorPlayCoaching`) already return `null` when `vectorSnapshotStale()` is true (#4400/#4402).

## Root cause

`play-brief-narrative-coaching.ts` `vexCoaching` read `vec.vexFlip` / `vec.vexWalls` without the shared stale gate.

## Fix

Early `return null` when `vectorSnapshotStale(vec, Date.now())`. Regression test added.

## RTH validation

Open a swing play-brief with stale Vector snapshot (>120s `dataAgeMs`) — VEX coaching bullet should be absent; chart/Vector desk stale disclaimers still present.
