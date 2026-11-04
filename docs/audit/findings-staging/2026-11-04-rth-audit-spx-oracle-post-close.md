> **kind:** FINDING

## RTH deep audit P0: SPX oracle live desk vs prev-close after the bell — FIXED

| | |
|---|---|
| **Area** | `scripts/full-site-deep-audit.mjs` |
| **Status** | FIXED — `scripts/full-site-deep-audit.test.mjs` |
| **Severity** | P2 (scheduled audit false positive, not member-facing bad data) |

### Root cause

RTH deep audit run `41912133395` (2026-11-04 ~16:03 ET) failed:

`[oracle] SPX: desk 7683.82 vs Polygon prev-close 7568.92 (Δ 1.518% > 1.5% tol)`

After Polygon `marketstatus` reports closed, the script compared platform snapshot **live** SPX to
**prior daily close**. On a >1.5% up session that is expected divergence, not a desk bug.

### Fix

Run the spot oracle only when Polygon market is **open** (live index snapshot, 0.3% tol). When
closed, emit an explicit skip pass — do not fetch `/prev` for this check.

### Evidence

GitHub Actions `RTH deep audit` log excerpt; `node --test scripts/full-site-deep-audit.test.mjs`.
