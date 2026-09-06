# Largo C2 — stale Vector snapshot still coached magnet/VEX/flow/confluence/walls

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Area** | Night Hawk Swings / Ask Largo coaching bullets |
| **PR** | (pending) |

## Symptom

`technicalsCoaching` and `vectorPlayCoaching` already gated on `vectorSnapshotStale()`, but seven sibling Vector coaching helpers (`magnetCoaching`, `expectedMoveCoaching`, `confluenceCoaching`, `wallIntegrityCoaching`, `wallDynamicsCoaching`, `vexCoaching`, `flowPrintsCoaching`) and trade-manager proximity/wall-event narration still rendered directional coaching from snapshots >120s old. `vectorPlayCoaching` also still printed thesis/invalidation lines when stale — it only suppressed the "aligned" claim.

## Fix

Early-return `null` from each coaching helper when `vectorSnapshotStale()` is true; gate `tradeManagerNarrativeSection` proximity/wall-event bullets and Vector-sourced γ-flip break triggers the same way.

## Verify at RTH

Open a swing play brief on a ticker with aged Vector cache (>120s) and confirm coaching bullets omit magnet/VEX/flow/confluence/wall-integrity/dynamics lines and trade-manager read omits "Nearest wall" / "Wall just moved" prose.
