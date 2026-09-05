# 2026-09-05 — Vector wall-cache future skew + legacy-marks roundFloats

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Severity** | P1 (wall cache skew) / P2 (legacy-marks floats) |
| **Area** | Vector wall rail recording, Night Hawk legacy marks API |
| **Status** | FIXED |

## Symptom

1. `recordVectorWallSamplesFromWarm` and `buildVectorStreamPayload` used `nowMs - cachedWallsAt <= STALE_RECORD_MAX_MS` without a future-timestamp guard — cross-replica clock skew made stale fallback walls recordable as fresh.
2. `GET /api/market/nighthawk/legacy-marks` returned raw IEEE floats on option marks.

## Root cause

- Wall recordability reused raw age math instead of shared `isWsUpdatedAtFresh`.
- Legacy marks route missed the Sep 2026 API-boundary `roundFloats` sweep.

## Fix

- `isWallCacheRecordable()` wraps `isWsUpdatedAtFresh` for GEX/VEX wall cache timestamps.
- Legacy marks response wrapped with `roundFloats({ available: true, marks })`.

## Evidence

- `vector-wall-rail-rth-gate.test.ts` — future-skew source scan.
- `legacy-marks/route.test.ts` — roundFloats boundary scan.

## RTH validation

- During RTH, confirm Vector wall rail still accumulates samples for SPX/SPY when cache is genuinely fresh.
- Legacy Night Hawk detail rail: option marks show 2dp, no long float tails.
