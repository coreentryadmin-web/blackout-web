> **kind:** FINDING

## Night Hawk Swings: "Break watch" — the single most safety-critical, always-shown line in the whole brief — never stated how close its cited risk is — FIXED

**Status:** FIXED

### Root cause

`breakTrigger` (`play-brief-narrative.ts`) builds the "Break watch" bullet — explicitly documented
in this file's own history as reserved, always shown, and bypassing `MAX_BULLETS` specifically
because "safety-critical break coaching must not starve." It is shared by both
`tradeManagerNarrativeSection`'s own bullet and `resolveBreakInvalidation` (the headline
`envelope.invalidation` field `play-brief.ts` exposes), so both call sites carried the same gap.

The level selection (`resolveInvalidationFocalLevel`) already returns a full `FocalLevel` object
with a `distancePct` field (`(price - spot) / spot * 100`, signed, documented inline as needing "no
extra spot plumbing" because it's already computed) — but `breakTrigger` only ever read `.price`
off that object into `support`/`resist`, discarding `.distancePct` before constructing the final
sentence. Every sibling "key level" line elsewhere in the same brief (GEX call/put wall, gamma
flip, max pain, the committed structural stop) states `"(X% away)"`; the one line a member is told
is the single most important thing to watch did not.

Found during this session's own static audit (fixed `watchForSection`'s "Entry trigger" line for
the identical gap minutes earlier, PR #6641 — re-checking sibling level-rendering call sites for
the same class of omission surfaced this one, a materially higher-stakes instance of the same
pattern).

### Evidence

Confirmed via direct reading of `breakTrigger`/`resolveInvalidationFocalLevel`
(`play-brief-narrative.ts`) that `distancePct` is computed and attached to every `FocalLevel`
(including the `gamma_flip` fallback entry) but never read past level *selection*. Confirmed via
`grep` that two existing exact-string tests in `play-brief.test.ts` (fixture: spot 24.5, put wall
22) asserted the bare-distance string, which the fix's RED proof then changed in lockstep.

### Fix

Added a small `distAwaySuffix(level)` helper that renders `Math.abs(level.distancePct).toFixed(1)`
as `" (X.X% away)"` (or `""` when no level), applied to all three branches:

1. LONG, primary wall/dark-pool/king candidate (`invalidationLevel`).
2. SHORT, primary candidate (`invalidationLevel`).
3. LONG, the gamma-flip fallback (no wall/dark-pool/king below spot at all) — changed the
   existing `.some()` existence check to `.find()` so the matched `FocalLevel`'s own
   `distancePct` is available too, rather than just a boolean.

No new spot plumbing, no new computation — the value was already there and already correct
(verified against the SAME formula every sibling line in this file uses); this just stops
discarding it before the sentence is built.

### Blast radius

Single function (`breakTrigger`), both its call sites (`tradeManagerNarrativeSection`'s bullet,
`resolveBreakInvalidation`'s `envelope.invalidation`) pick up the fix automatically since both route
through it. Two exact-string tests in `play-brief.test.ts` updated to match (fixture: spot 24.5,
put wall 22 → 10.2% away) — every other existing assertion on this output used a loose `.*` regex
and needed no change (confirmed: full `play-brief*.test.ts`, 1153/1153 green unchanged).

### Fix rationale

Reused the exact `Math.abs()`/`toFixed(1)` convention this file already uses everywhere else for
the identical "(X% away)" phrasing, rather than inventing new formatting. Scoped to the three
branches that already select a real `FocalLevel`/flip candidate — did not touch the separate
premium-stop fallback branches (`lose premium stop $X`) a few hundred lines below, which construct
their own, unrelated strings off option mark/execStop, not an underlying structural level, and are
untouched by this change.

### Tests

- RED: confirmed via `git stash` of only `play-brief-narrative.ts` that three new tests fail
  against the old code (bare price, no suffix) — verified the exact expected percentages against
  the brief's own sibling "Put wall 90.00 (-10.0% from spot)" line in the same test's output.
- GREEN: restored the fix — all three new tests pass; full `play-brief*.test.ts` (1153 tests) and
  full `npm test` (16701/16704, 3 skipped, 0 fail) green; `npx tsc --noEmit` clean.
- Added `tradeManagerNarrativeSection: LONG Break watch states how far the structural support level
  is from spot`, the SHORT sibling, and the LONG gamma-flip-fallback sibling (all 2026-10-24).
