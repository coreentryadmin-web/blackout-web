## Meridian's SPX earnings card could show the wrong call/put wall — FIXED

> **kind:** FINDING

| | |
|---|---|
| **Status** | FIXED |
| **Area** | Meridian earnings desk — SPX/SPXW cross-product card |
| **File** | `src/lib/meridian/meridian-cross-product-for-earnings-core.ts` |
| **Severity** | P3 — member-visible but not trading-decision logic; a display-level mislabel |

### Root cause

`shapeMeridianSpxDeskRead` renders `MeridianEarningsIntelPanel.tsx`'s SPX inline card line
`Walls {put_wall} – {call_wall}` straight off the SPX desk's `gex_walls` ladder
(`SpxDeskSummary.gex_walls`, built by `topGexWalls` in `src/lib/providers/gamma-desk.ts`).

That ladder is explicitly documented as sorted **strike descending for display**, with `kind`
derived purely **geometrically** (`strike > spot → "resistance"`, else `"support"`) — `gamma-desk.ts`'s
own doc comment warns consumers to derive the call/put wall from net_gex **sign/magnitude**, not
from `kind` alone: *"The component derives the 'call/put wall' label from net_gex SIGN... geometry
≠ sign."*

The local `topGexWalls` helper in `meridian-cross-product-for-earnings-core.ts` ignored that
warning. It walked the ladder and took the **first** row of each kind:

```ts
if (row.kind === "resistance" && call == null) call = strike;
if (row.kind === "support" && put == null) put = strike;
```

Because the array is strike-descending, "first resistance encountered" is the **highest strike
overall** — the FARTHEST resistance in the ladder — while "first support encountered" is the
highest strike among supports — the NEAREST support to spot. That asymmetry is the bug: one side
picks the farthest wall of its kind, the other picks the nearest.

The real-world ladder this feeds from is built by `topGexWalls` (gamma-desk.ts) as: one guaranteed
anchor per side (the strike with the single largest-magnitude net_gex, picked by SIGN, which can
sit anywhere relative to spot) **plus** several smaller proximity-fill strikes walked outward from
spot on each side, up to `limit` (default 6) total. Whenever the true dominant call wall sits close
to spot and a weaker proximity-fill strike extends farther out above it, the old loop reported that
farther, weaker decoy as "the call wall" — understating how close dealers are actually defending,
and showing a wider, incoherent `Walls X – Y` band than the real dealer-defended range.

### Evidence (RED → GREEN)

Added a test with a ladder shaped exactly like production's (strike-descending, two resistance
rows and two support rows per side — a far weak decoy plus a near dominant wall on each side):

```ts
gex_walls: [
  { strike: 6550, net_gex: 0.5, kind: "resistance", distance_pts: 100 },  // far, weak decoy
  { strike: 6500, net_gex: 5,   kind: "resistance", distance_pts: 50 },   // near, dominant — the real call wall
  { strike: 6400, net_gex: -3,  kind: "support",    distance_pts: -50 },  // near, dominant — the real put wall
  { strike: 6350, net_gex: -0.4, kind: "support",   distance_pts: -100 }, // far, weak decoy
],
```

RED (pre-fix): `read.call_wall === 6550` (expected `6500`) — `AssertionError: 6550 !== 6500`.
GREEN (post-fix): `read.call_wall === 6500`, `read.put_wall === 6400`.

The pre-existing single-wall-per-side test (one resistance, one support) could never have caught
this — with only one candidate on each side, "first in array order" and "largest |net_gex|"
always agree. The bug only surfaces once the ladder carries more than one wall per side, which the
real `topGexWalls` ladder (limit=6, proximity-filled) routinely does.

### Fix

Changed the local `topGexWalls` helper to track the largest-magnitude net_gex on each side
(largest positive for the call wall, most negative for the put wall) instead of array position —
the same definition `gamma-desk.ts`'s own `topGexWalls` anchor selection and
`meridian-event-expiry-core.ts`'s `scopeStructureToExpiry` already use. Array order no longer
matters; `net_gex` (already present on every `GexWall` row) decides.

### Blast radius

`topGexWalls` (the local helper) has exactly one call site, `shapeMeridianSpxDeskRead`, which has
exactly one call site, `loadMeridianEarningsIntel` → `intel.spx` → `MeridianEarningsIntelPanel.tsx`'s
SPX/SPXW inline card (`Walls {put_wall} – {call_wall}`, `call_wall`/`put_wall` fields generally).
No other file reimplements this exact "first row of kind X in a strike-sorted ladder" pattern
against `gex_walls` without an additional distance/filter constraint, except
`src/lib/bie/spx-invalidation.ts` (out of scope — `src/lib/bie/**` is excluded from this sweep) and
several `.find(...)` call sites elsewhere in `src/features/spx/lib/**` that all carry an additional
proximity/price filter alongside the `kind` check, which bounds how far the mis-pick could land —
those are display helpers for the SPX desk itself, a separate decision-adjacent surface this sweep
does not touch; flagged here as a lead for a future round, not fixed in this PR.

### Fix rationale

Fixing by net_gex magnitude (rather than, say, re-sorting the array by distance-from-spot) matches
the canonical definition used everywhere else a "call wall"/"put wall" is selected from a GEX
ladder in this codebase, so Meridian's SPX card now agrees with the SPX desk's own definition of
its walls instead of silently reimplementing a third, weaker one. Nothing about the ladder's own
construction, sort order, or the SPX desk's rendering of it was touched — only this one
display-shaping consumer.
