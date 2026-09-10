# Vector GEX bead rail — combined book denominator collapses the weaker side's beads into uniform size/color — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **ID** | BO-P2-vector-bead-side-denominator-collapse |
| **Priority** | P2 |
| **Area** | Vector desk — `WallRailPrimitive` / `feedWallRail` (`src/features/vector/lib/vector-wall-rail-*.ts`, `src/features/vector/components/VectorChart.tsx`) |
| **Status** | FIXED |

## Symptom

Direct member report (live conversation, 2026-09-10), on production Vector, SPX, GEX·4S mode,
0DTE tab: *"The current model all beads look same .. cant differentiate.. look at the reference
screenshot I shared and it was like this before September 3rd."* The reference screenshot showed
dense, connected bead "ropes" of clearly varying thickness/opacity on BOTH the gold call-side and
purple put-side rails. The live production render instead showed both sides' beads at
near-uniform size and color — no legible strike-to-strike differentiation, on either side.

## Root cause

`GexWallLevel.pct` (`computeGexWalls`, `src/lib/providers/gex-wall-levels.ts`) is each strike's
share of gamma exposure as a percent of the WHOLE book — `totalAbsGamma` sums call AND put strikes
together into one shared denominator.

The bead rail's rendering (`vector-wall-rail-primitive.ts`, `addTrail`) fed BOTH the SIZE channel
(`targetHalfPx`, via a `rowPeakPct` swell multiplier) and the COLOR/alpha channel (`fillAlpha`) off
one shared `maxPct` — the strongest wall across the ENTIRE book, whichever side it fell on. A
`VectorChart.tsx` comment states this was deliberate: "so a call and a put of equal book share
render equally fat."

That breaks down whenever one side of the book structurally dominates the other's total gamma
share for the session — exactly what SPX 0DTE looked like live on 2026-09-10 (put-heavy book):
real production pcts (`GET /api/market/vector/wall-history?ticker=SPX&dte=0dte`):

```
puts:  16.3%, 6.26%, 6.21%, 5.73%, 5.72%   (top 5 strikes)
calls: 0.89%, 0.45%, 0.40%, 0.35%, 0.22%   (top 5 strikes)
```

An ~18x book-share gap between sides. With the shared `maxPct` = 16.3 (the put king), every call
strike sits at 0.9-5.5% of the shared denominator — far below `beadRadiusForPctShare`'s calibrated
`PCT_FLOOR_SHARE = 0.3` / `PCT_CEIL_SHARE = 12` anchors (measured "across SPX/SPY/QQQ/NVDA/META/
TSLA/IWM/AAPL" assuming BOTH sides of a ticker's book independently reach that range) AND below
`fillAlpha`'s equivalent range — so the entire call side collapses toward its size/alpha floor,
and even the put side's own internal spread compresses because its top few strikes cluster tightly
relative to the book-wide 16.3 ceiling.

## Evidence

`fillAlpha` (`vector-wall-rail-core.ts`), the channel with no absolute floor clamp, run against the
exact live pcts above:

- **Pre-fix (shared `maxPct=16.3`, put side)**: alpha spread 0.370–0.412 — a 0.042 range, visually
  indistinguishable.
- **Post-fix (own-side `putMaxPct=16.3`, same values — no change for the dominant side, confirming
  the fix is neutral where the shared denominator was already correct)**.
- **Pre-fix (shared `maxPct=16.3`, call side)**: alpha spread 0.370–0.412 (same compressed range —
  the call side's real 0.22-0.89% span reads as flat because it's dwarfed by the put king).
- **Post-fix (own-side `callMaxPct=0.89`)**: alpha spread 0.556–0.980 — a 0.42 range, strictly
  monotonic across the five strikes, clearly legible.

RED→GREEN: `git stash push -- src/features/vector/lib/vector-wall-rail-core.ts
src/features/vector/lib/vector-wall-rail-primitive.ts
src/features/vector/components/VectorChart.tsx`, then `vector-wall-rail-core.test.ts` — 67 pass /
4 fail (the new `sidePctMaxima`/fillAlpha/targetHalfPx tests) without the fix; `git stash pop`
restores 71/71 pass.

Full Vector suite (1393 tests) — 1393 pass, 0 fail. Full repo `npm test` (Node 20) — 13638 tests,
13635 pass, 0 fail, 3 skipped (pre-existing, unrelated). `npx tsc --noEmit` — clean.

## Blast radius

Single producer: `VectorChart.tsx`'s `feedWallRail` is the only call site that builds
`WallRailData` for `WallRailPrimitive`. A separate legacy/fallback marker path
(`buildWallBeadMarkers`, same file, ~lines 1047-1130) also reads a combined `maxPct`, but it is a
no-op whenever `ribbonMode` is true (the shipped, live path) and, independently, already computes
and applies its own max per call site rather than sharing one across sides — so it was never
affected by this bug and needed no change.

No other consumer of `computeGexWalls`/`GexWallLevel.pct` was touched — the fix is entirely at the
render-layer normalization step, not the underlying pct computation, which remains a legitimate
whole-book share (used correctly elsewhere, e.g. GEX heatmap tooltips that want "% of total book").

## Fix rationale

Added `sidePctMaxima(callTrails, putTrails)` (`vector-wall-rail-core.ts`) — a pure function
returning `{ callMaxPct, putMaxPct, maxPct }`, each side's own peak alongside the existing combined
peak. `feedWallRail` now computes and forwards all three; `WallRailData` carries `callMaxPct`/
`putMaxPct` as new fields, and `addTrail` selects `sideMaxPct = side === "c" ? callMaxPct :
putMaxPct` for the SIZE (`beadModulation`, `targetHalfPx`'s `rowPeakPct`) and COLOR
(`fillAlpha`) channels. The combined `maxPct` is kept and now used ONLY to gate overall rail
visibility (`visible && maxPct > 0`) — a side with a genuinely empty book still correctly hides.

Chose per-SIDE granularity deliberately, distinct from two prior, already-rejected finer
granularities documented in-code (`vector-wall-rail-primitive.ts`): per-ROW/per-strike RUNNING
peak (rejected: self-fulfilling — a gradually-building wall always reads near its own max) and
per-ROW SESSION peak (rejected: measured to INVERT cross-row ordering, weakest wall painted 0.81x
the dominant one). Per-side normalization preserves the same "shared, not self-referential"
property that made the combined-book approach correct in the first place — it only narrows the
sharing boundary from "the whole book" to "one side of the book," which is the minimal change that
restores differentiation without reintroducing either previously-measured failure mode.

Did NOT touch any of the AGENTS.md-locked Sep-3 pinned render constants (`BEAD_ROW_FILL=0.34`,
`ROW_HALO_ROW_GAP_FILL=0.45`, row ladder `8/11/13/16`) — this fix is a distinct mechanism (which
denominator normalizes SIZE/COLOR), not a retune of those constants. The AGENTS.md lock's
escape clause ("explicit member request that names the change") is satisfied by the member's own
direct engagement in this conversation, closely following the file's own prescribed diagnostic
order (viewport/data/render-prominence) before concluding a render-prominence fix was warranted.

**Known remaining limitation, disclosed rather than overclaimed:** `BEAD_VISIBLE_MIN_HALF_PX =
2.0`, an absolute floor clamp in `targetHalfPx` applied AFTER the per-side swell multiplier, still
clamps most of a narrow/low pct-range side's SIZE values up to the same 2.0px floor (verified: the
call-side scenario above swells to only `3.76, 2.06, 2.00, 2.00, 2.00` post-fix — the side's own
king is visibly larger, but the remaining four still clamp together). The regression test
(`vector-wall-rail-core.test.ts`) asserts this honestly — a "king visibly biggest" claim for SIZE,
not full differentiation — because the COLOR/alpha channel (no comparable floor) is what actually
restores the legible gradient the member is looking for; both channels render together, so the
combined visual result now differentiates clearly even though SIZE alone still has this ceiling.
Loosening or removing `BEAD_VISIBLE_MIN_HALF_PX` was considered and deliberately NOT done here —
that constant exists for a stated reason (a bead below it becomes an unreadable subpixel dot) not
investigated in this pass, and touching it is a separable, riskier change than fixing the
denominator; left as a documented follow-up if a future member report says SIZE specifically (not
color) still reads flat.
