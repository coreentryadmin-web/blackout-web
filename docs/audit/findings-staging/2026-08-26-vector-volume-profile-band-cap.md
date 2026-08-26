# Vector volume-profile band still spans too much of the chart — FIXED

> **kind:** FINDING

| Field | Value |
|---|---|
| **Status** | FIXED |
| **Component** | `src/features/vector/lib/vector-volume-profile-layout.ts` |
| **Reported** | 2026-08-26, live member screenshot (SPX, market closed) |

## Root cause

`volumeProfileGutter()` sized the volume-profile bar band as **all** the whitespace between the
last candle and the price axis, with no upper bound. That whitespace is not a fixed quantity — the
prior fix in this same file (#2927, `VECTOR_VP_RIGHT_OFFSET_PX` 108→64) only pins the *time axis's*
own right-side reserve. Outside RTH, or whenever the visible time window reserves room for a
session that hasn't happened yet, the last drawn candle can sit far left of the price axis,
leaving hundreds of px of unrelated empty space — which `volumeProfileGutter` then filled
entirely. Live evidence: a member screenshot (market closed, SPX) showed the profile block
covering roughly a third of the chart's width, still circled as "too much space" even after the
color/size-constant fix had shipped.

## Evidence

Reproduced live post-deploy on `/vector?ticker=META` and `/vector?ticker=NVDA`: the color palette
was confirmed fixed (blue/silver, not yellow/purple — #2927 holds), but the profile band's actual
drawn width tracks `lastCandleX` to `priceAxis`, not a fixed cap, so it varies with how much of the
pane happens to be empty rather than with what's useful to show.

## Fix

Added `VECTOR_VP_MAX_BAND_PX = 110` and clamped `volumeProfileGutter`'s band to it, independent of
how much raw whitespace exists. Bars stay right-anchored to the price axis (`rightX` unchanged) —
capping the band only pulls the far (left) edge of the widest bar inward, so behavior at typical
zoom (where whitespace is already under the cap) is unchanged; only the pathological wide-gutter
case (this bug) is affected.

## Blast radius

Only consumer of `volumeProfileGutter` is `vector-volume-profile-primitive.ts`'s `project()` — one
call site, no other component reads the gutter shape.

## Tests

`src/features/vector/lib/vector-volume-profile-layout.test.ts`: added a regression test asserting
the band caps at `VECTOR_VP_MAX_BAND_PX` even when raw whitespace is much larger, plus kept/updated
the existing under-cap case. `npx tsx --test` clean; full suite 10972 pass / 0 fail / 2 skipped;
`tsc --noEmit` clean.
