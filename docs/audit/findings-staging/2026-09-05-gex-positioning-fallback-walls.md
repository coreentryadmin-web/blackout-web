> **kind:** FINDING

## GEX positioning polygon-fallback served unconstrained walls — FIXED

| Field | Value |
|-------|-------|
| **Status** | FIXED (pending merge) |
| **Severity** | P1 |
| **Area** | `/api/market/gex-positioning` degraded fallback |
| **Branch** | `fix/gex-positioning-fallback-walls` |

### What was broken

When `getGexPositioning()` returned null (cold matrix), the route's `fetchPolygonPositioningBundle` fallback picked max-positive and max-negative GEX strikes **without** requiring call walls above spot or put walls below spot. Members read these as resistance/support — an inverted wall is worse than a missing one.

Primary path in `gex-positioning.ts` already used `wallsFromStrikeTotals(..., base.spot)`; only the route fallback loop was left on the unconstrained scan.

### Fix

Replace the manual max/min loop with `wallsFromStrikeTotals(strikeTotals, bundle.spot)` in `src/app/api/market/gex-positioning/route.ts`. Source-scan regression in `wall-side-constraint.test.ts`.

### RTH validation

On a cache-miss ticker during RTH, force degraded path (or wait for natural miss) and confirm `call_wall >= spot` and `put_wall <= spot` when non-null.
