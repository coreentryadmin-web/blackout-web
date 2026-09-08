# Largo stale Vector EMA/regime steelmanned in counter-thesis

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Status** | FIXED (PR pending) |
| **Area** | Night Hawk Swings / Ask Largo |
| **Contract** | Largo C2 (freshness / absence) |

## Symptom

`counterThesisLine()` already gated stale Vector `play.bias` (#4387) but still steelmanned bear/bull EMA stack and dealer gamma regime from stale Vector technicals/regime while `dataFreshnessSection` warned lag.

## Root cause

EMA stack (425–427) and Vector regime posture (429–437) read `vec.technicals` / `vec.regime` without `vectorSnapshotStale()` — same class as pre-#4387 play.bias gap.

## Fix

Compute `vectorStale` once; omit EMA and Vector regime from counter-thesis when stale. GEX-only posture fallback still gated by `gexMatrixStale()`.

## Evidence

- `npx tsx --test src/lib/swing/play-brief-narrative.test.ts` — 2 new regression tests pass
- `npx tsc --noEmit` — clean
