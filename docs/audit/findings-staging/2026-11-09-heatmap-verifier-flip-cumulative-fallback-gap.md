# 2026-11-09: heatmap-verifier's DEX/CHARM zero-level check false-FLAGs a real cumulative sign-change crossing on sparse/banded chains

> **kind:** `FINDING`

**Status.** FIXED — this PR.

## Summary

`src/lib/correctness/heatmap-verifier.ts`'s `zeroLevelRealCrossingCheck` (the VEX/DEX/CHARM
`zero_level` "is the reported level a real sign-change crossing" invariant, task #139) derives its
own independent crossing via a local helper, `deriveFlip()`, and flags a mismatch with the served
`zero_level` as `"zero-level-real-crossing"` failing — "reported zero-level is NOT at an
independent sign-change crossing... zero-level is not a real sign change."

`deriveFlip()` was written to find only the ADJACENT per-strike sign crossing nearest spot, with
no distance guard. Production's `zeroGammaFlip()` (`src/lib/providers/gex-cross-validation-core.ts`
— the function `computeZeroGammaFlip`, used for DEX/CHARM `zero_level`, is aliased to) was hardened
later, in #5523 ("reject implausible far-strike VEX/DEX/CHARM flip crossings"), to (a) reject a
per-strike crossing beyond 12% of spot as a thin-far-strike artifact of the banded chain snapshot,
and (b) fall back to a CUMULATIVE running-total sign-change crossing (also band-filtered) when no
per-strike crossing is plausible. `deriveFlip()` — part of #139, which predates #5523 — was never
updated to track that change.

Consequence: on a sparse/banded chain where the ONLY adjacent per-strike crossing sits far from
spot (the exact shape #5523 was written for) but the cumulative running total crosses zero near
spot, production correctly rejects the far per-strike artifact and reports the real cumulative
crossing — while `deriveFlip()`, lacking both the band filter and the cumulative fallback, still
returns the far, implausible per-strike crossing as "the" independent derivation. The check then
compares a genuinely real zero-level against a derivation that was never looking in the right
place, and FLAGs a correct reading as fake — a false positive on this verifier's own audit output,
exactly the "verifier checking a stale/wrong field after the system it checks changed shape" class
flagged by prior rounds (`data-integrity-verifier.ts` #7863, `largo-verifier-support.ts`,
`nighthawk-verifier.ts`).

## Root cause

`deriveFlip()` (heatmap-verifier.ts) only ever computed the simple per-strike adjacent-sign-flip
list and picked whichever crossing was nearest spot, unconditionally — no plausibility band, no
fallback path. `zeroGammaFlip()` (gex-cross-validation-core.ts), which is what production's served
DEX/CHARM `zero_level` is actually built from (`polygon-options-gex.ts` lines ~1616/1628/3975/3986,
aliased `computeZeroGammaFlip`), gained two things `deriveFlip()` never picked up:

1. A plausibility filter — a per-strike crossing beyond `FLIP_MAX_DIST_PCT` (12%) of spot is
   rejected outright, never returned, per the measured live AMZN case in that function's own
   comment (vexFlip computed 58.8% away from spot on a real banded chain).
2. A cumulative-sum fallback — when no per-strike crossing is plausible, it scans the running
   total for its own sign change (also band-filtered) and returns THAT level instead of null.

Because `deriveFlip()` has neither, any case where production's real zero_level comes from path
(2) above gets compared against `deriveFlip()`'s naive pick from a completely different crossing
(the far per-strike one from path (1), which production correctly discarded) — a mismatch that the
check cannot distinguish from a genuine bug.

## Evidence (RED → GREEN)

Constructed the minimal reproduction of the #5523 shape directly in `strike_totals` (spot=100):

- `{10: -500, 20: 400, 90: 50, 100: 80}` — the only adjacent per-strike crossing is between 10 and
  20 (≈15.56, 84% from spot — implausible); the cumulative running total (-500, -100, -50, +30)
  crosses zero between strikes 90 and 100, interpolating to 96.25 (3.75% from spot — plausible).
  Production would report `zero_level: 96.25`.

RED (pre-fix, via `git stash` isolating only `heatmap-verifier.ts`'s source change, the new
regression test left in place):

- New test `"dexCharmInvariantChecks: DEX zero_level reported off a CUMULATIVE sign-change (no
  plausible per-strike crossing) — still consistency-only, not a false FLAG"` **FAILED**: the
  `zero-level-real-crossing` check outcome was `"flag"` (expected `"consistency-only"`), with detail
  text `"Reported zero-level 96.25 is NOT at an independent sign-change crossing (nearest 15.56)"` —
  the exact false positive described above.
- Full suite: 32/33 pass, 1 fail (that new test).

GREEN (post-fix, fix restored):

- Full suite: 33/33 pass.
- `npx tsc --noEmit`: clean, no errors.

## Fix

Rewrote `deriveFlip()` to mirror the same two additions `zeroGammaFlip()` has, independently
reimplemented (not imported — it stays a from-scratch derivation so a real bug in either path is
still catchable):

1. Filter per-strike crossings to within `TOL.flipBandFractionOfSpot` (new constant, 0.12 — same
   value as production's `FLIP_MAX_DIST_PCT`, the shared design parameter both sides are
   independently implementing, not the logic under test) of spot before picking the nearest; if
   none are plausible, fall through instead of returning a far artifact.
2. On fallthrough (or no per-strike crossings at all), scan the running cumulative total for its
   own sign change, band-filtered the same way, mirroring `zeroGammaFlip`'s own fallback loop
   structure (first qualifying crossing wins, not necessarily nearest-to-spot — matches production
   exactly).

Left every other function in this file untouched — `deriveCumulativeGammaFlip` (the GEX gamma-flip
analog, which already has its own correct band+lowest-plausible logic matching
`cumulativeGammaFlip`) was not touched, and `blockSumAndSignChecks` / `postureMatchesSignCheck` /
`crossToolChecks` / `dexCharmCrossToolChecks` were read closely for the same bug class and found
correct: the cross-tool functions are honestly labeled `consistency-only` (never claiming
independent confirmation) because they compare two surfaces that both derive from the SAME held
`hm` snapshot via the documented temporal-immune pattern, exactly as their own code comments say —
not a "fake independent confirmation" shape.

## Blast radius

One function (`deriveFlip`), consumed by exactly one check (`zeroLevelRealCrossingCheck`), called
for exactly two metrics (`dex_zero_level`, `charm_zero_level` — VEX has no equivalent check wired
in this file today). No other caller of `deriveFlip` exists in the codebase. This is an audit-tool
false-positive fix (the verifier's own output), not a production data-correctness fix — the served
`zero_level` values themselves were never wrong; this cron's audit report could previously raise a
spurious FLAG on a correct reading for any ticker whose chain happens to be sparse/banded enough to
trip the exact #5523 shape on the DEX/CHARM side.
