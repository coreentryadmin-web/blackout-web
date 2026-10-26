> **kind:** `FINDING`

## Gamma-flip session table can display a rounding-masked tie — FIXED

**Status.** FIXED (PR #6794).

### Area

`src/app/(marketing)/research/gamma-levels/[ticker]/page.tsx` — the public (noindex) per-ticker
gamma-levels research page's "Session by session" table. Backed by `formatLevel`/`flipSentence`
(`src/lib/research/gamma-levels-copy.ts`) and `closedAboveFlip`/`buildGammaLevelsResearch`
(`src/lib/research/gamma-levels-core.ts`). Not owned-lane (confirmed via import grep on all three
edited files — no owned-lane paths referenced).

### Found by

Live-UI + code-correctness sweep, DISCOVERY-lane, 2026-10-26.

### Root cause

`formatLevel()` rounds any price at or above $100 to zero decimals for display. The "Session by
session" table renders `close` and `gammaFlip` through this same function, while the page's header
narrative (`flipSentence`, built from `research.flip.{sessions, closedAbove, aboveRate}`) and the
per-row `closedAboveFlip: gammaFlip === null ? null : input.bar.close > gammaFlip`
(`gamma-levels-core.ts`) compare the **raw, unrounded** floats with a strict `>`.

At a 3-digit price level, two genuinely different raw values can round to the identical displayed
number — e.g. close `348.3` vs. flip `347.6` both display as `348` — so a row can look tied in the
table while the header's "closed above its gamma flip on N of M sessions" count still correctly
counts it as above (or below). The reader has no way to verify the claim against a tied-looking
row. Live-confirmed on `/research/gamma-levels/AAPL` (several session rows showing identical
Close/Gamma-flip numbers); a control check on `/research/gamma-levels/ABBV` (all 10 sessions
differ by $5+, matching the claimed 10/10/100% with zero ties) confirmed the underlying math is
correct and this is a display-precision/trust gap, not a computation bug — it only manifests when
a session's close and flip land within roughly $1 of each other at $100+ prices, which is an
ordinary, expected occurrence rather than a rare edge case.

### Fix

Added `flipSideLabel(closedAboveFlip: boolean | null): "Above" | "Below" | "—"`
(`gamma-levels-copy.ts`) and a `FlipSidePill` badge in the page component, both reading the same
already-computed, unrounded `closedAboveFlip` field already present on every `SessionLevels` row.
Added a new "Flip side" column to the session table, mirroring the existing `OutcomePill`-based
Call Wall / Put Wall Result columns. `formatLevel`'s rounding and all computation in
`gamma-levels-core.ts`/`flipSentence` are deliberately unchanged — purely additive rendering
sourced from existing data.

### Blast radius

Single consumer: the ticker page. `flipSideLabel` has no other callers (confirmed via grep); same
for `formatLevel`'s existing behavior, which is untouched. No owned-lane paths touched.

### Tests

New unit test for `flipSideLabel` in `gamma-levels-copy.test.ts`. RED→GREEN via `git stash` on the
two source files (fails with the missing-export module error pre-fix, passes post-fix). `tsc
--noEmit` clean. Full suite on Node 20: 17019 pass / 0 fail / 3 pre-existing skips (unrelated).
