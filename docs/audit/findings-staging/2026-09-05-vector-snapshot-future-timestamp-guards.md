# 2026-09-05 — Vector snapshot VEX/flip/bead future-timestamp guards

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Severity** | P2 |
| **Area** | `vector-snapshot.ts` — VEX walls, gamma flip, wall bead recordability |
| **Status** | FIXED |

## Symptom

Sibling gamma-wall path (`cachedWallsAt`) was fixed 2026-09-05 to use `isWsUpdatedAtFresh`, but VEX walls (`cachedVexWallsAt`), gamma flip (`cachedFlipAt`), hub SWR refresh gates, and wall-bead recordability still used raw `Date.now() - at` math. A clock-skewed future timestamp yields negative age → falsely fresh cache and can stamp stale wall beads into the rail history.

## Root cause

Incremental freshness sweep fixed `cachedWallsAt` / `wallScope` only; VEX, flip, dark-pool SWR, and `gexRecordable`/`vexRecordable` gates were missed.

## Fix

Route all five through shared `isWsUpdatedAtFresh(...)` (same guard as UW halt gate and gamma walls).

## Evidence

- `vector-snapshot-wallscope-freshness.test.ts` — extended source-scan assertions for VEX, flip, hub SWR, bead recordability.

## RTH validation

- Vector `/vector` desk: VEX lens walls refresh on cadence; flip overlay does not pin overnight when GEX positioning updates.
- Wall rail history: no flat overnight segments stamped from skewed-fresh fallback caches during provider blips.
