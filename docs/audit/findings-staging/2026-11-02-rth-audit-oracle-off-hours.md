> **kind:** FINDING

## RTH deep audit P0 off-hours — SPX Polygon oracle vs desk

| **Status** | FIXED (PR pending) |

**Symptom:** `scripts/full-site-deep-audit.mjs` failed P0 on `main` CI (`audit` / RTH deep audit) with `[oracle] SPX: desk 7552.74 vs Polygon 7541.40 (Δ 11.34)` while cross-tool integrity correctly reported market closed.

**Root cause:** The Polygon oracle always compared platform snapshot SPX to `I:SPX` snapshot even when `spx.market_open` was false. Off-hours the desk can carry a different anchor (live composite / last RTH) than Polygon’s session close field.

**Fix:** Skip the oracle when `snap.json.spx.market_open !== true`, matching data-integrity’s RTH-only cross-check policy.

**Verify:** Re-run RTH deep audit workflow off-hours — expect `oracle/SPX: market closed — oracle skipped (by design)` and zero P0 oracle failures.
