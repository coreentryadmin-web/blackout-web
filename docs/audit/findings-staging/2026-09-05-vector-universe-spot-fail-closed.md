# 2026-09-05 — vector-universe GEX walls: null spot must fail-closed, not run unconstrained

> **kind:** FINDING

| Field | Detail |
|---|---|
| **Symptom** | During cold-cache Polygon contention, `fetchGexHeatmap` can return `strike_totals` while `spot` is still `null`. The universe row then served wrong-side `topCallWall` / `topPutWall` (e.g. call wall below spot) and persisted the same into narrowed 0DTE/weekly/monthly wall-history rails. |
| **Root cause** | `buildVectorUniverseRow` passed `spot: undefined` into `computeGexWalls` when spot was unknown. That restores the unconstrained peak scan — the exact bug PR #3495 fixed on the live rail — instead of mirroring `getVectorGexWalls()` which returns `null` walls when spot is unknown. |
| **Fix** | Gate both blended and narrowed-horizon GAMMA `computeGexWalls` calls on `spot != null && spot > 0`; otherwise emit empty `{ callWalls: [], putWalls: [] }`. VEX walls stay unconstrained (no above/below-spot geometry). |
| **Status** | FIXED |

**Regression guard:** `src/features/vector/lib/vector-universe.test.ts` — `NOSPOT` fixture + source-scan for fail-closed gate.

**RTH check:** Open Vector scanner during first 5 minutes after open; tickers that briefly show `spot:null` in `/api/market/vector/universe` must not carry a non-null `topCallWall` below a later-resolved spot.
