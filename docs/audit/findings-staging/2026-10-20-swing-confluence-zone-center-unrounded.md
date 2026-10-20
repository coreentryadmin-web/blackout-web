## A swing play-brief's confluence-zone level price was the one `ConfluenceZone.center` call site that never rounded a weighted-average float — FIXED (defense-in-depth)

> **kind:** `FINDING`

| **Status** | Fixed |
|---|---|

**Found:** 2026-10-20, Ask Largo standing mandate — a fresh-angle Workflow audit cross-checking the
swing play-brief against `docs/audit/LARGO-PRODUCT-CONTRACT.md`'s precision point, independently
re-verified by me before shipping (see "Scope/blast-radius note" below — this entry is written to
reflect that independent re-check honestly, not the workflow's original, overstated reachability
claim).

**Root cause:** `ConfluenceZone.center` (`src/features/vector/lib/vector-confluence.ts`) is computed
as a weighted average (`weightedPrice / centerWeightSum`), which routinely produces a long
floating-point tail — the exact "round at the data layer" systemic issue this repo's own CLAUDE.md
names (e.g. `7499.360000000001`). Two sibling call sites of this same field already round it before
display: `play-brief-intel.ts` and `play-brief-narrative-coaching.ts` both read it through
`fmtPriceLevel(z.center)`. The one place that builds a swing play-brief's structured `envelope.levels`
array from a confluence zone — `levelsFromContext` in `src/lib/swing/play-brief.ts` — pushed
`z.center` through unrounded. This was the one omission among otherwise-consistent siblings.

**Fix:** `levelsFromContext`'s confluence-zone branch now rounds the center to 2dp at the source
(`Math.round(z.center * 100) / 100`) before constructing the level object, matching what the sibling
call sites already do. No shared numeric-only round-to-2dp helper exists in this codebase (the
existing `fmtPriceLevel` returns a formatted string, not a number), so the round is inlined exactly
as the sibling call sites' own `fmtPriceLevel` usage implies.

**Fix rationale:** Round at the exact point the value is produced for this structured field, rather
than relying on a later, external wrapper two layers away. Did not touch `ConfluenceZone.center`
itself (upstream, used for other purposes that may want full precision) or the two sibling display
call sites that already round correctly via `fmtPriceLevel`.

**Scope/blast-radius note (independently re-verified, not taken from the audit sub-agent's original
claim):** the audit that surfaced this cited `extrasFromBriefResponse`/`snapshotFromBrief`
(`play-brief.ts`) reading the pre-`roundFloats()` envelope as proof the raw value "genuinely
propagates." On closer inspection this does not hold: `extrasFromBriefResponse`'s level-matching
logic does plain substring matching on `"spot"`/`"gamma flip"`/`"call wall"`/`"put wall"` — none of
which match a confluence-zone's own label (`"confluence (call-wall+gamma-flip)"`) — so that internal
consumer never actually extracts a confluence zone's price at all. Both real external consumers of a
swing play-brief — the HTTP route (`route.ts`) and the Largo tool wrapper
(`src/lib/largo/swing-play-brief-read.ts`) — already call the fully-recursive `roundFloats()` before
the envelope reaches a member or Largo's own context, which neutralizes the raw float regardless of
this fix. This fix is shipped as a genuine defense-in-depth / sibling-consistency correction (the
value is correct at its own source now, rather than depending on an external wrapper), not as a
confirmed live-member-facing bug — the independent trace found no reachable path where the unrounded
value was ever actually served.

**Tests:** 1 new regression test in `play-brief.test.ts` — a confluence zone with
`center: 7499.390909090909` (a real non-terminating weighted-average tail,
`(3*7499.30 + 2.5*7499.50) / 5.5`) asserts the resulting `envelope.levels` entry's `price` is exactly
`7499.39`. RED→GREEN proven via `git stash` (1/1 new test fails pre-fix with the raw unrounded float,
passes post-fix; full `play-brief.test.ts` file 158/158 pass post-fix). `tsc --noEmit` clean. Full
local suite green on Node 20.
