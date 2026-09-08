# Largo stale Vector regime in resolveGammaPosture — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Area** | Ask Largo / Night Hawk Swings |
| **Pri** | P1 |
| **PR** | (pending) |

## Symptom

`resolveGammaPosture()` returned `vec.regime.posture` unconditionally, even when `vectorSnapshotStale()` was true. Dealer-posture coaching (`dealerPostureLine`, `magnetCoaching`, king/magnet focal narration) could therefore cite "long-gamma pins rallies" from a stale Vector snapshot while `dataFreshnessSection` separately warned Vector data was old — Largo C2/C5 contradiction.

## Root cause

`play-brief-absence.ts` `resolveGammaPosture()` gated the GEX-only fallback with `gexMatrixStale()` but not the Vector regime path.

## Fix

Gate Vector regime on `!vectorSnapshotStale(vec, readMs)` before returning; fall through to live GEX posture, then null when both are stale. Added `readMs` param for testability (matches `gexMatrixStale` / `vectorSnapshotStale`).

## Evidence

- `npx tsx --test src/lib/swing/play-brief-absence.test.ts` — 3 new regression tests (stale Vector → GEX fallback, both stale → null, live Vector wins)
