## 2026-09-04 — [FINDING, P2 Correctness] Vector narrowed-horizon wall writes ignored spot constraint — FIXED

> **kind:** `FINDING`

| Field | Detail |
|---|---|
| **Priority** | P2 correctness |
| **Surface** | `src/features/vector/lib/vector-universe.ts` (`horizonWalls` / 0dte-weekly-monthly durable rails) |
| **Status** | FIXED |

### Root cause

`buildVectorUniverseRow` passed `spot` into `computeGexWalls` for the blended live rail (#3495) but the narrowed-horizon writer (`horizonWalls`, feeding durable 0dte/weekly/monthly wall-history via `writeWallHistorySample`) still called `computeGexWalls` with `spot: spot ?? undefined` — no `spot > 0` guard. A zero or negative spot let call walls land below spot (and put walls above), persisting wrong-side geometry into session history even after the live rail was fixed.

### Fix

Match the blended rail: `spot: spot != null && spot > 0 ? spot : undefined`.

### Regression guard

`src/features/vector/lib/vector-universe.test.ts` — `recordVectorUniverseWallSample: narrowed-horizon (0dte) wall write never lands on the wrong side of spot` (7/7 pass, Node 20).
