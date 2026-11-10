> **kind:** `FINDING`

## RTH deep audit P0: GEX "cold during RTH" during Polygon circuit pause

| | |
|---|---|
| **Status** | FIXED |
| **Area** | `src/lib/data-integrity-checks.ts`, `run 42897223779` @ 15:38 ET |

### Root cause

`data-integrity` C6 flagged SPX/SPY as cold while the shared Polygon circuit was open (Sentry: `[polygon] Circuit open — rate limited`). Full-site heatmap checks seconds later were green — transient upstream throttle, not a stuck desk matrix.

### Fix

- `loadGexPositioningForIntegrity` re-reads via `fetchGexHeatmap` + `gexPositioningFromHeatmap` when the light reader returns null.
- `shouldSkipGexColdDuringRth` skips C6 when `isPolygonCircuitOpen()` is true.

Bundled: swing-discovery grouped-daily memo + 429 retry (same branch) to reduce circuit trips.
