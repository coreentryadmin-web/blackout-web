# Largo C2 — stale Vector snapshot still grounded BieLevel envelope + dealer posture evidence

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Area** | Night Hawk Swings / Ask Largo (`composeSwingPlayBrief`) |
| **PR** | (pending) |

## Symptom

`levelsFromContext()` and `evidenceFromContext()` in `play-brief.ts` gated GEX-matrix staleness for walls/king/posture fallback, but Vector-sourced walls (`vec.gexWalls`), max pain, confluence, dark pool, and `regime.posture` still reached `envelope.levels` / `envelope.evidence` when `vectorSnapshotStale()` was true — the same class of dishonesty fixed in narrative sections by #4376–#4400.

## Fix

Import `vectorSnapshotStale` and suppress Vector-sourced envelope levels + dealer-posture evidence when the desk snapshot is stale; live GEX fallback still allowed when matrix is fresh.

## Verify at RTH

Open a swing play brief on a ticker with aged Vector cache (>120s) and confirm `envelope.levels` omits max pain/confluence/dark pool and `envelope.evidence` has no dealer-posture row citing Vector regime.
