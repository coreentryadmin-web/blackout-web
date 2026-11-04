> **kind:** FINDING

## RTH deep audit false P0: platform snapshot SPX vs Polygon prev-close after cash close — FIXED

| | |
|---|---|
| **Area** | `scripts/full-site-deep-audit.mjs` SPX Polygon oracle |
| **Status** | FIXED — regression test updated |
| **Severity** | P0 in CI only (not a member-facing data defect) |

### Root cause

After Polygon `marketstatus/now` reports `market !== "open"`, the deep audit still compared
`/api/market/platform/snapshot`'s **session SPX mark** to Polygon **`/prev` close** with a 1.5%
tolerance. On a normal up/down day that delta is the session return itself — not a cross-source
price bug.

Measured: RTH deep audit run 41912133395 @ 2026-11-04T21:03Z (Wed **16:02 ET**):

`desk 7683.82 vs Polygon prev-close 7568.92 (Δ 1.518% > 1.5% tol)`.

### Fix

Run the oracle **only** while Polygon reports the cash market open — live index snapshot vs live
desk, 0.3% tolerance via `spxOracleVerdict(..., true)`. When closed, record an explicit skip pass
(do not compare to prev-close).

### Verify next RTH

During cash session, deep audit should still print `[oracle] SPX: desk … vs Polygon live …`.
