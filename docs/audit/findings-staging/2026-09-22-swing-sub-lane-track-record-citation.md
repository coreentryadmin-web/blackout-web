> **kind:** FINDING

## Ask Largo — Night Hawk Swings: sub-lane track-record citation was fully built, wired write-side, and unit-tested — but had zero read-side call sites — SHIPPED

**Status:** SHIPPED

### Root cause / gap

`calibration-cache.ts` (PR #4685, 2026-09-09) distills TWO independently-gated dimensions of
graduated historical track record every cron tick — archetype (`snapshot.archetypes`) and
**sub-lane** (`snapshot.subLanes`, TACTICAL 5-7d vs STANDARD 8-21d) — and exposes a symmetric
read-side pair, `graduatedArchetypeEntry()` and `graduatedSubLaneEntry()`, both gated identically
on the Largo C6 confidence-omission principle (`graduated:true` required, Wilson-LB + point-Δ≥15pt).
`graduatedSubLaneEntry()` had 3 passing unit tests in `calibration-cache.test.ts` proving the gating
logic worked — but a repo-wide grep showed **zero call sites outside its own test file**.
`archetypeTrackRecordSection()`'s own doc comment (`play-brief-intel.ts`) explicitly named this as a
deliberate, disclosed deferral: *"combining two graduated dimensions into one citation... is left as
a follow-up; shipping the archetype citation alone is the smaller, correct slice."* That was the
correct call at the time (2026-09-09/10) but CLAUDE.md's Ask Largo mandate requires re-verifying
every deferred item against current `main` each cycle rather than treating a documented deferral as
permanent — and the archetype-only citation has now been live long enough (2 weeks) with no
regression to prove the pattern is safe to extend.

### Fix

Extended `archetypeTrackRecordSection()` (`src/lib/swing/play-brief-intel.ts`) to also read
`play.subLane` against `snapshot.subLanes` via the pre-existing `graduatedSubLaneEntry()` and render
it as an ADDITIONAL, independently-gated paragraph — never merged into the archetype's own stat
(that would double-count the same underlying graded rows across two overlapping cuts of the same
population, since a graded swing play belongs to exactly one archetype AND exactly one sub-lane
simultaneously). Each dimension renders on its own honest gate:
- archetype graduated + sub-lane graduated → both paragraphs
- only one graduated → that one alone
- neither graduated (the common case today — the closed-swing population is still ~31-37 trades,
  the same sample-size ceiling `archetypeTrackRecordSection` already documented) → section omitted
  entirely, same as before this change

No change to the write side (already correct), no change to the gating math (reused verbatim), no
change to `archetypeTrackRecordSection`'s existing archetype-only behavior for any play whose
sub-lane bucket hasn't graduated — this is strictly additive.

### Evidence

- `graduatedSubLaneEntry` call-site count before: 0 (outside tests). After: 1
  (`play-brief-intel.ts`).
- New tests in `play-brief-intel.test.ts`: sub-lane-alone rendering, both-dimensions rendering
  (each cites its OWN wins/losses, not the other's), neither-graduated → null, and an unrecognized
  `subLane` string treated as absent (never fabricated) — mirroring the existing archetype tests'
  discipline exactly.
- `npx tsx --experimental-test-module-mocks --test src/lib/swing/play-brief-intel.test.ts`:
  197/197 pass (193 pre-existing + 4 new).
- Live spot-check 2026-09-22 (off-hours): swing's real closed-position population (~31-37 trades
  across ~5-6 archetypes and 2 sub-lanes) still has no sub-lane bucket graduated yet — this section
  correctly renders nothing new on live data today, exactly as documented above; it starts firing on
  its own once a sub-lane bucket clears the bar, no further code change needed (same self-activating
  design as the archetype citation's own #4685 history).

### Blast radius

Only `archetypeTrackRecordSection()`'s output changes (additive), consumed by
`buildIntelSections()`/the swing play-brief. No other caller of `graduatedArchetypeEntry` or the
snapshot shape changed. `swing-loss-taxonomy-segment.mjs`'s 2026-09-10 measurement (TACTICAL
sub-lane diverging to an 80% loss rate at n=5, flagged as a real signal to watch) is the concrete
motivating case this citation will surface once that sub-lane's real closed population clears the
Wilson-LB graduation bar.
