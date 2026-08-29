## Thermal GEX heatmap could serve a call_wall/put_wall label that disagreed with its own strike_totals bars — FIXED

> **kind:** `FINDING`

| **Status** | FIXED in `fix/gex-heatmap-ws-wall-strike-totals-consistency` |
| **Severity** | P0 — member-facing Thermal/Grid GEX matrix, wall label can point at the wrong bar |
| **Surface** | `src/app/api/market/gex-heatmap/route.ts` (live-WS wall override + reconciliation pipeline) |

### Root cause

Caught live by the scheduled `RTH deep audit` GitHub Actions workflow (`node scripts/full-site-deep-audit.mjs`, `auditHeatmapMatrix`), which independently re-derives the call/put wall from a response's own `gex.strike_totals` (the tallest positive/most-negative strike) and compares it to the response's reported `gex.call_wall`/`put_wall`. Two consecutive scheduled runs 22 minutes apart (2026-08-29, off-hours Friday night) both failed identically:

```
P0: [heatmap] AAPL.call_wall: reported 330 != 320
P1: [heatmap] IWM: unavailable or empty
```

Tracing the route: when the live UW WS ladder is available (`hasLiveGexStrikeExpiry`), the route overrides `heatmap.gex.call_wall`/`put_wall` with a wall picked from that live ladder ("same source Vector and Slayer use," for freshness) — but left `heatmap.gex.strike_totals` untouched, still holding the older Polygon-derived values. `strike_totals` is what `GexHeatmap.tsx` actually renders as the heatmap bars (`GexHeatmap.tsx:2961`), while `call_wall` drives the separate wall-level marker (`GexHeatmap.tsx:2976`) — two different sources feeding one panel. Whenever the live WS ladder's top strike differed from Polygon's, a member could see the "Call Wall" label pointing at a strike that was not even the tallest bar in the chart right next to it.

A first-pass fix (replace `strike_totals`/`total` with the WS-derived values at the same point the wall labels are overridden) looked sufficient in isolation but was silently undone ~120 lines later: `reconcileCellStrikeTotals` (`round-floats.ts`) recomputes each strike's `strike_totals` entry from `cells` (the per-expiry breakdown, which stays Polygon-sourced and is NOT touched by the WS override) for every strike present in `cells` — which is effectively every strike, since the WS ladder and Polygon chain cover the same near-term strikes. So the WS-derived `strike_totals` I set got overwritten back to the Polygon values by the very next reconciliation pass, while `call_wall`/`put_wall` (never touched by that reconciler) stayed WS-derived — reproducing the exact same mismatch one step later in the same pipeline.

### Evidence

New test in `route.test.ts`: `when the live WS ladder disagrees with Polygon's strike_totals, the served call_wall/put_wall and strike_totals stay mutually consistent` — constructs a Polygon-cached heatmap whose cells/strike_totals imply a 320 wall and a live WS ladder that implies 330 (the exact AAPL numbers from the live failure), and asserts the served `strike_totals` re-derives the SAME wall the response reports as `call_wall`, and that `total` still equals `sum(strike_totals)`. Full `route.test.ts` suite: 13/13 pass (Node 20, `--experimental-test-module-mocks`). Also re-ran `round-floats.test.ts`, `gex-cross-validation-core.test.ts`, `gex-wall-levels.test.ts` (69 tests) clean — none of the reconciliation/wall-derivation invariants those files pin were altered.

### Blast radius

Only this route. `computeGexWalls`/`gex-wall-levels.ts` (Vector chart overlay), `gex-positioning.ts`, and `validateGexAgainstUW` (the UW cross-validation oracle) are untouched — they already read the SAME live WS ladder independently for their own wall computations and were never affected by this route's own internal strike_totals/call_wall split. `vex`/`dex`/`charm` blocks are untouched (the WS override only ever applied to `gex`).

### Fix rationale

Kept the WS-derived label override (deliberate, matches Vector/Slayer freshness) but made it atomic: when it applies, `strike_totals` and `total` are replaced from the SAME WS ladder pick (`strikeTotalsFromLadder`/`wallsFromStrikeTotals`, already imported and used one line above for the wall pick — no new dependency), so the whole `gex` summary block — label, bars, and total — is sourced from one ladder rather than two. To keep that from being clobbered by the downstream cell-reconciliation pass (which is itself a deliberate, tested invariant — "a strike's displayed total always equals what a member would get by manually summing that strike's own displayed near-term cells," per its own header comment — and stays correct for the far more common non-WS-override case), a `gexStrikeTotalsFromWs` flag skips `reconcileCellStrikeTotals` for `gex` specifically when the WS override applied, while `reconcileStrikeTotal` (which only sums whatever `strike_totals` already is, agnostic to source) still runs unconditionally to keep the `total == Σ(strike_totals)` invariant the audit also checks. Did not touch `cells` itself — the WS ladder has no per-expiry breakdown to populate it with, and nothing reads `cells` against `strike_totals` for consistency in the WS-override path (the only cross-check is the audit's own `total == Σ(strike_totals)`, which the fix preserves).
