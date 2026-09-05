# Pattern-scan fixes: UW sweep + play-bars rounding + universe spot fail-closed

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **ID** | BO-P2-0106 |
| **Priority** | P2 |
| **Area** | API / cron / Vector universe |
| **Status** | FIXED (pending merge) |

## What was broken

1. **`data-correctness` cron** called `runFullCorrectness` / `runHeatmapCorrectness` without `runWithBackgroundUwSweep`, competing with live member traffic on the cluster-wide 2 RPS UW budget during RTH sweeps (desk-verifier + heatmap-verifier both hit `fetchSpxOdteScopedUwLadder`).

2. **`/api/market/nighthawk/play-bars`** returned raw Polygon minute-bar closes without `roundFloats`, leaking IEEE float noise into the play detail chart.

3. **`buildVectorUniverseRow`** ran `computeGexWalls` with `spot: undefined` when spot was missing, still populating `topCallWall` / `topPutWall` from unconstrained scans — same class as PR #3495 but on the spot-null edge path.

## Fix

- Wrap both sync and async `data-correctness` sweep paths in `runWithBackgroundUwSweep`.
- Wrap play-bars JSON in `roundFloats(...)`.
- Fail-closed GEX walls when `!(spot > 0)`; skip narrowed-horizon writes without spot.

## Evidence

- Source-scan regression tests in `data-correctness/route.test.ts`, `play-bars/route.test.ts`, `vector-universe.test.ts`.
- `npm test -- --test-name-pattern="data-correctness imports|data-correctness wraps|rounds IEEE|GEX walls require"` GREEN on Node 20.

## Market-open check

- RTH: trigger `GET /api/cron/data-correctness?force=1&surface=heatmap` — completes without starving live UW reads.
- Open a Night Hawk play detail chart — minute closes show 2dp, no `4.400000000001` tails.
- `GET /api/market/vector/universe` — no ticker with `spot:null` and non-null `topCallWall`/`topPutWall`.
