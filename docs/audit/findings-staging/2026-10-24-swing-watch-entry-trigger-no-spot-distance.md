> **kind:** FINDING

## Night Hawk Swings: "Entry trigger" was the one price level in the whole Ask Largo WATCH brief with no distance-from-spot context — FIXED

**Status:** FIXED

### Root cause

Every other price level `watchForSection`/`play-brief-narrative.ts` narrates in a swing play-brief
states how far current spot sits from it, as `"(X% away)"`:

- GEX call/put wall, gamma flip — `nearestWallOrFlipLine` (`play-brief-intel.ts`)
- committed structural stop — `committedStructuralStopLine` (`play-brief-narrative.ts`), fixed
  2026-10-17 specifically to correct the denominator of this exact convention
  (`(spot - level) / spot`, never `/ level`)

The "Entry trigger" line in `watchForSection` (`play-brief-intel.ts`, ~line 1900) is arguably the
single most actionable number in a WATCH brief — the exact price a trader is waiting to see broken
or reclaimed — and it never carried this annotation. It rendered a bare price plus a causal verb
("Break/reclaim above ... this is what actually fires the setup") with no sense of proximity,
while every sibling level line in the same document quantified exactly that.

This was not caught by any existing test because no prior test supplied a resolved `spot` (via
`ctx.vector`/`ctx.ecosystem.gex_positioning`) to a WATCH-bucket `entryTriggerUnderlyingPx` test —
every existing fixture for this line used `vector: null, ecosystem: null`, so the gap was
invisible to the suite until a spot was actually wired in.

### Evidence

Static audit (this cycle's board was weekend-frozen, no live repro available) — confirmed via
`grep` that `(X% away)` is used for call wall, put wall, gamma flip, max pain, and the committed
structural stop line everywhere else in `play-brief-intel.ts`/`play-brief-narrative.ts`, but never
for `entryTriggerUnderlyingPx`. Confirmed via the `BieLevel` type (`src/lib/bie/answer-envelope.ts`)
that there's no structured distance field either — the fact, if present anywhere, has to live in
prose, same as every sibling level.

### Fix

Added the identical `(spot - trigger) / spot` convention (matching `committedStructuralStopLine`'s
corrected denominator, not the wrong one it replaced) to the "Entry trigger" line, **only** when:

1. `spot` is actually known this cycle (never guessed), and
2. spot is still on the not-yet-triggered side of the level in the entry direction.

When spot has already moved through the trigger in the entry direction, the distance suffix is
omitted entirely rather than stating a now-nonsensical "N% away" for a level that's already been
crossed — that's a materially different fact (a crossing that already happened), which belongs to
`entryStatus`/`entryTriggerDeadReason`, not something this fix should invent or guess at. This
avoids the exact "two sections of one brief disagreeing about the same fact" failure class this
file's own history is full of (see the 2026-10-20 TSLA/UNH/MU fixes in the same section).

### Blast radius

Single call site (`watchForSection`'s WATCH-bucket branch, `play-brief-intel.ts`). No other
renderer narrates `entryTriggerUnderlyingPx` with a distance figure (confirmed via repo-wide grep —
`play-brief.ts`'s structured `levels[]` array and `play-brief-narrative-coaching.ts`'s two uses of
the field compute unrelated distances: trigger-vs-wall collision and trigger-vs-invalidation
cushion, neither of which is spot-vs-trigger).

### Fix rationale

Reused the file's own established convention exactly (same formula, same "(X% away)" phrasing,
same denominator correction already proven right elsewhere) rather than inventing a new one.
Deliberately did NOT attempt to classify "already through" with its own explanatory text (e.g.
"already through this level") — that would require reasoning about `entryStatus`/live triggering
semantics this fix has no need to touch, and the file's history shows exactly that kind of
over-reach causing contradictions between sections. Omission is the safe, honest choice per the
Largo product contract's absence principle.

### Tests

- RED: confirmed via `git stash` of only `play-brief-intel.ts` that the new "states how far spot
  is" test fails (bare price, no suffix) against the old code.
- GREEN: restored the fix — same test passes; all 323 tests in `play-brief-intel.test.ts` and all
  1148 across `play-brief*.test.ts` pass; `npx tsc --noEmit` clean.
- Added `watchForSection: entry trigger states how far spot is from firing it, when spot is known
  and still approaching` and `watchForSection: entry trigger distance is omitted (never guessed)
  once spot has already moved through it in the entry direction`.
