# Vector GEX walls unconstrained without spot — FIXED

> **kind:** FINDING

| Field | Value |
|---|---|
| **Status** | FIXED |
| **Severity** | P1 |
| **Area** | Vector / GEX walls |
| **PR** | (pending) |

## Symptom

On a cold Vector task before the heatmap primed `fallbackSpot`, `getVectorGexWalls()` called `computeGexWalls()` with `spot: undefined`. That runs the unconstrained path where call walls can sit below spot and put walls above it — inverted resistance/support geometry members would see as live walls.

## Root cause

`vector-snapshot.ts` passed `s.fallbackSpot ?? undefined` without failing closed when spot was still null. `computeGexWalls` intentionally allows unconstrained mode for the VEX lens, but gamma walls require spot side-constraint.

## Fix

- Added `resolveVectorWallSpot()` — heatmap spot first, then live candle close.
- `getVectorGexWalls()` and narrowed-horizon WS path return `null` when no valid spot (honest empty) instead of unconstrained walls.

## Regression test

`src/features/vector/lib/vector-snapshot-walls.test.ts` — IBIT-shaped ladder: null without spot; strike 47 call wall when spot=46.06.

## Market-open validation

On Vector `/terminal` for a non-oracle ticker during first load after deploy: walls should be absent briefly rather than showing inverted call/put levels below/above spot.
