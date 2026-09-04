# Vector snapshot GAMMA walls missing spot constraint

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Area** | Vector / GEX walls |
| **Severity** | P1 |

## Symptom

Vector desk GAMMA-lens walls could render wrong-side call/put nodes when `fallbackSpot` was `0` or unset — `computeGexWalls` ran unconstrained.

## Root cause

`vector-universe.ts` was fixed (PR #3495) with `spot != null && spot > 0 ? spot : undefined`, but three GAMMA-lens call sites in `vector-snapshot.ts` still passed `s.fallbackSpot ?? undefined`.

## Fix

Guard all three `computeGexWalls` calls in `vector-snapshot.ts` with the same `fallbackSpot > 0` check. Source-scan regression in `vector-wall-rail-rth-gate.test.ts`.

## RTH validation

On `/vector` during RTH, confirm GAMMA wall nodes sit on the correct side of spot for a dynamic ticker with live WS ladder data.
