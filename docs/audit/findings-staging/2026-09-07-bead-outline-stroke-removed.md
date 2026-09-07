# Vector bead rail: remove per-bead outline stroke (member-directed)

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Area** | Vector chart bead rail (`WallRailPrimitive`) |
| **Authorization** | Explicit, repeated member request (2026-09-07 session) — see below |

## Symptom

Member reported (screenshots, Sep-3 ~8-11am ET reference vs. current live render): "no outer rings"
on the reference, current beads show visible individual circle outlines. Repeated across several
messages with increasing specificity: "we dont have any fucking outer rings .. and all beads are
not same sized .. I want it like this" — i.e. plain filled circles, size varies by wall magnitude,
no separate ring/border layer.

## Root cause

`WallRailPrimitive.draw()` (`vector-wall-rail-primitive.ts`) stroked a crisp outline
(`ctx.stroke()`, 1-1.25px) around every bead with radius >= 2.2px — this has been in the code since
before the pinned Sep-3 reference commit (`b2931b64b`), confirmed via `git diff b2931b64b origin/main
-- src/features/vector/lib/vector-wall-rail-primitive.ts` returning zero lines. It was not a
regression in the sense of "something changed" — it was always there. But whether the outline is
*visible* depends on whether a strike's beads are dense/large enough to fully overlap along their
row: when they do (a strongly-concentrated strike), neighbouring fills hide each other's borders
and the row still reads as one solid ribbon; when a strike's gamma share is weaker, its beads are
smaller with real gaps, and each individual border becomes visible — a field of separate ringed
circles.

Measured live (2026-09-07): on Sep-3 ~11am ET, 17/20 top strikes (both sides) had bead diameter
exceeding the ~5.4px 3m bar spacing (so they fused, hiding the outline); on the session displayed
today only 8/20 did. Same unchanged formula (`beadRadiusForPctShare`), different real gamma
concentration on the two sessions — which is why the outline was invisible on the reference and
visible today, without any code difference. The member's ask is to make the "no ring" look
unconditional rather than incidental to how concentrated a given session's book happens to be.

## Fix

Removed the per-bead stroke entirely (both the `r >= 2.2` branch and the compare-pane
`strokeAlphaBoost` branch) from the core paint path in `WallRailPrimitive.draw()`. Beads are now a
single filled circle, radius still driven purely by `beadRadiusForPctShare` (magnitude), no border.

**Deliberately untouched:**
- `beadRadiusForPctShare` / the log-ladder size calibration — size-by-magnitude is exactly what the
  member asked to keep.
- The strength halo (`rowStrengthHaloExtraPx`, temporal row-peak bloom) — a separate, unconditional
  translucent under-layer, not named in the member's complaint.
- Integrity-tier rings (`_showIntegrityRings`) — a member-togglable indicator, OFF by default, not
  what's rendering on a fresh session.
- The birth-marker vertical line stroke (`EDGE_ALPHA`) — an unrelated event glyph, not a per-bead
  ring.
- `strokeAlphaBoost` is now a dead config field on `BeadRenderTuning` (only ever consumed by the
  removed stroke branches) — left in place rather than widening this PR to also touch
  `vector-wall-rail-core.ts`'s tuning defaults; a natural small follow-up, not required for the
  visual fix.

## Verify

```
npx tsx --test src/features/vector/lib/vector-wall-rail-primitive-no-outline.test.ts
```

Source-pattern test (the primitive is a lightweight-charts `ISeriesPrimitive` requiring a live
canvas context, so it can't be exercised under `tsx --test` directly — same constraint the file's
own header comment already documents, and the same convention `vector-chart-viewport.test.ts` uses
for this exact reason). RED before the fix (`git stash` on the primitive alone), GREEN after.

Full Vector suite: 1374/1374 pass. `npx tsc --noEmit`: clean.

## Note

This is a render-prominence change to the AGENTS.md-locked Vector bead rail, which explicitly
requires "an explicit member request that names the change" before touching anything past
viewport/data-density (debug-order items 1-4). That authorization is the member's own repeated,
increasingly explicit request in this session (quoted above) — not a unilateral experiment.
