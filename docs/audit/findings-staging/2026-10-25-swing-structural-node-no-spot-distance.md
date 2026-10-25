> **kind:** FINDING

## Night Hawk Swings: "Structural support/resistance node" in Watch levels never stated its distance from spot either — FIXED

**Status:** FIXED

### Root cause

6th instance of the same omission class found and fixed this session (Entry trigger #6641, Break
watch #6648, narrateDarkPool/narrateKing/narrateFlip #6651, Watch-levels gamma-flip #6653). The
"Structural support/resistance node" line in `watchForSection` cites `invalidationLevel` — the
exact same `FocalLevel` object the sibling "Break watch" bullet (a few lines above, fixed in
#6648) already reads `.distancePct` off — yet this line never did, reading a bare
`{label} **{price}**` with no sense of proximity, while its own sibling two lines up in the same
function now states exactly that for the identical level.

### Evidence

Direct reading confirmed `invalidationLevel.distancePct` is computed (via
`resolveInvalidationFocalLevel`/`collectFocalLevels`) and already read for the "Break watch" line,
but discarded before this line's construction. Confirmed via `grep` that existing tests either use
loose `.*` wildcards or an unanchored substring match, so none break from the inserted suffix.

### Fix

Added the identical `` ` (${Math.abs(invalidationLevel.distancePct).toFixed(1)}% away)` `` suffix
this function already uses everywhere else this session, reusing the already-resolved value — no
new computation.

### Blast radius

Two lines (LONG/SHORT branches), single function. No existing test needed updating — all existing
assertions on this output use loose regexes or unanchored substrings that tolerate the inserted
text.

### Fix rationale

Same as the five earlier fixes this session: reuse the established convention, touch only the
branch responsible, add nothing new to compute.

### Tests

- RED: confirmed via `git stash` of only `play-brief-intel.ts` that the new test fails against the
  old code (bare price, no suffix).
- GREEN: restored the fix — same test passes; full `play-brief*.test.ts` (1163 tests) and full
  `npm test` (16716/16719 pass, 3 skipped, 0 fail) green; `npx tsc --noEmit` clean.
- Added `watchForSection: Structural support node states its distance from spot (2026-10-25)`.
