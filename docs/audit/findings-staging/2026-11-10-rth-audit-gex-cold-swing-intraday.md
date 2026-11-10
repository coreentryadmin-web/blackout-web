# RTH deep audit — GEX cold false-P0 + swing-discovery POWER_HOUR watchdog

> **kind:** FINDING

## Symptom

`main` RTH deep audit run `42897223779` (Tue 15:38 ET):

- P0 `data-integrity`: `getGexPositioning(SPX|SPY)` no matrix while heatmap API healthy
- `cron-watchdog`: `swing-discovery` in `problem_keys` during POWER_HOUR

## Root cause

1. **GEX**: `runDataIntegrityChecks` sampled `getGexPositioning` once; a brief Redis/rebuild gap during Polygon circuit pressure returned null on both roots while `/api/market/gex-heatmap` still served matrices.
2. **swing-discovery**: `swingDiscoveryAwaitingPhaseSuppress` only applied after POST_CLOSE was satisfied — intraday phase windows (e.g. POWER_HOUR before 4:15 PM) still surfaced handshake staleness.

## Fix

- `resolveGexPositioningForIntegrity()` — 2.5s retry + `fetchGexHeatmap` → `gexPositioningFromHeatmap` fallback before C6 cold flags.
- Intraday active-phase branch in `swingDiscoveryAwaitingPhaseSuppress`.

| **Status** | FIXED |
