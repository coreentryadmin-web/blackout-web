> **kind:** FINDING

## Largo cross-product GAMMA system read divided by the flip level instead of spot — wrong denominator, third instance of this defect class this week — FIXED

| **Status** | Fixed (`gammaRegimeRead()`, `src/lib/largo/core/system-reads.ts`) |
|---|---|

**Found via:** this session's standing Ask Largo deep-dive (5-engine monitor cycle, 2026-10-18), a
background agent extending the already-shipped wrong-denominator sweep (PR #6158, 2026-10-17 —
`committedStructuralStopLine()` in `src/lib/swing/play-brief-narrative.ts` and the CLOSED-bucket
"reclaimed the stop level" line in `src/lib/swing/play-brief-intel.ts`) from `src/lib/swing/*.ts` /
`src/lib/bie/*.ts` into `src/lib/largo/core/*.ts`, the cross-product consensus layer, which hadn't
been checked yet.

**Root cause.** `gammaRegimeRead(input)` computed `pct` as `((spot - gammaFlip) / gammaFlip) * 100`
— dividing by `gammaFlip` (the level) instead of `spot`. Every other implementation of this exact
"spot's % distance from a level" quantity in the repo divides by `spot`: `vector-regime.ts:86`,
`gex-positioning.ts:376`/`391`, `bie/vector-desk-intel.ts`, `bie/spx-desk-intel.ts`. The function's
own unit test (`system-reads.test.ts:61-68`) baked in the buggy output as its expected value
(`spot: 7760, gammaFlip: 7700` → `"+0.78%"`) — at that ~0.8%-wide gap the two conventions round to
visibly different-looking but easy-to-miss values; the correct spot-denominator convention gives
`"+0.77%"`. At a realistic wider gap (e.g. spot=120/flip=100) the divergence is a full 3.33
percentage points (16.67% correct vs 20.00% buggy) — a real, member-visible precision error, not a
rounding artifact.

**Blast radius.** `gammaRegimeRead` is called from exactly one site,
`src/lib/largo/core/system-reads-extract.ts:125`, which feeds Largo's cross-product "System reads"
panel. Confirmed member-visible: `src/features/largo/answer/LargoDeskRead.tsx:176` renders the
`basis` string (which embeds this percentage) verbatim in the rendered panel — not dead code.

**Why this one is lower severity than the swing-brief instances (#6158).** `gammaRegimeRead` is
explicitly `kind: "regime"` and hardcodes `stance: "neutral"` — per its own doc comment ("a state,
never a vote"), nothing downstream treats it as directional, so this is a display-precision defect
against the Largo Product Contract's "precision" point, not a trading-impacting one. Still fixed
with the same rigor, since LARGO-PRODUCT-CONTRACT.md's precision point exists precisely so members
can trust every number a product surface shows, not just the ones that move a trade decision.

**Fix.** Divide by `spot` instead of `gammaFlip`, matching the file-wide convention. Updated the
existing unit test's expected values to the correct convention and added a wide-gap regression test
(spot=120/flip=100 and the inverse) where the two conventions diverge by whole percentage points
rather than rounding to the same display value.

**Tests.** RED→GREEN proven via `git stash` of the source file alone (2 failures without the fix —
the pre-existing test's now-corrected expectations — 0 with it restored). Broader regression:
all of `src/lib/largo/**/*.test.ts` — 1364/1364 pass. `tsc --noEmit`: clean.
