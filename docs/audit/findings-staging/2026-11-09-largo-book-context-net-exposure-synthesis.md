# bookContextSection never synthesized net exposure when both concentration and internal conflict fire at once

> **kind:** `FINDING`

## Status

FIXED

## Root cause

`bookContextSection` (`src/lib/swing/play-brief-intel.ts`) can emit both a "Concentration" paragraph
(same-theme, same-direction book overlap) and an "Internal conflict" paragraph (same-theme,
opposed-direction overlap) for the same candidate — a real, reachable combination: `checkPortfolioOverlap`
(`portfolio.ts`) runs one pass over the book and classifies every matching row into `sameDir` or
`opposedDir`, so a theme with one same-direction peer and one opposed-direction peer populates both
lists in the same call. The two paragraphs were independently `lines.push()`'d and joined with
`lines.join("\n\n")` with no cross-reference — no ranking of which risk matters more for this entry
decision and no statement of the net theme exposure once both are weighed together, unlike
`renderCrossDeskConflict` (`play-brief-narrative-coaching.ts`), which explicitly ranks multiple
conflicting inputs about one candidate, names the most load-bearing one, and gives one resolution
for the structurally identical "several independent signals about one candidate" shape.

## Evidence (RED → GREEN)

Added to `src/lib/swing/play-brief-intel.test.ts`:

- `states net theme exposure and names the more decisive risk when BOTH concentration and internal
  conflict fire at once` (1-vs-1 split → "roughly balanced") and a second case with a 2-vs-1 split
  → "leans same-direction" naming concentration as more decisive — RED (pre-fix): no "Net theme
  exposure" text anywhere in the output; GREEN (post-fix): present.
- `does NOT add a net-exposure line when only one category fires` — regression guard against
  fabricating a comparison that has nothing real to compare.

Pre-fix: 2 of 4 new tests fail. Post-fix: 369/369 in `play-brief-intel.test.ts` (365 pre-existing +
4 new). Full `play-brief.test.ts` + `play-brief-adapter.test.ts` suites re-run clean (213/213,
unaffected). `npx tsc --noEmit` clean.

## Blast radius

The new line is appended only inside `bookContextSection`'s own `lines` array, only when both
`overlap.sameThemeSameDirection.length > 0` AND `overlap.sameThemeOpposedDirection.length > 0` —
every existing single-category call site (the overwhelming majority) is byte-identical to before.

## Fix rationale

Ranked by the real position COUNT on each side — the same quantity each paragraph above already
reports to the member, so the synthesis line adds a comparison between two numbers already shown,
never a new unverified claim. Three outcomes (leans same-direction / leans opposed / roughly
balanced) rather than a forced binary, each naming which existing paragraph is "the more decisive
risk" without silently discounting the other — matching the Largo contract's "disagreement is
represented, never reconciled" principle, which an adversarial-verify pass confirmed applies to
cross-PRODUCT disagreement (Vector vs Helix), not to synthesizing two findings about the SAME book
within one section, so adding this comparison does not violate it.
