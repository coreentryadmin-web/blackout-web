# Largo C2 — stale Vector snapshot still grounded coaching + trade-manager narrative bullets

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Area** | Night Hawk Swings / Ask Largo (`play-brief-narrative*`) |
| **PR** | (pending) |

## Symptom

After #4400–#4402 gated envelope levels, intel sections, and desk reads, four coaching helpers and two trade-manager narrative paths still grounded directional claims from stale Vector snapshots:

- `magnetCoaching`, `confluenceCoaching`, `expectedMoveCoaching`, `wallIntegrityCoaching` — no `vectorSnapshotStale()` gate
- `dealerPostureLine` — Vector `gammaFlip` cited when only GEX-fallback staleness was checked
- `tradeManagerNarrativeSection` — `proximity`, `wallEvents`, and break-trigger `gammaFlip` from stale Vector

## Fix

Return `null` from coaching helpers when `vectorSnapshotStale()`; null Vector flip/proximity/wallEvents in narrative paths when stale.

## Verify at RTH

Open a swing brief on a ticker with aged Vector cache (>120s) and confirm trade-manager read omits nearest-wall / wall-moved bullets and coaching rail has no magnet/confluence/expected-move/wall-integrity lines citing Vector.
