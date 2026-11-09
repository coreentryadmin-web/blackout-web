# StructureLadder.subLaneTrackRecord and StructureLadderRung.meta reach the HTTP response but BieStructureLadder.tsx never rendered either

> **kind:** `FINDING`

## Status

FIXED

## Root cause

Two real, computed fields on `StructureLadder` (`src/lib/swing/play-brief-ladder.ts`) reached
`envelope.structureLadder` in the swing play-brief HTTP response but were never read by
`BieStructureLadder.tsx`, the component's only renderer:

**`subLaneTrackRecord`** — `subLaneTrackRecordFor()` computes the exact sibling of
`archetypeTrackRecord` for the independently-graduated SUB-LANE dimension
(`graduatedSubLaneEntry`, TACTICAL/STANDARD), with the identical shape
(`subLaneLabel`/`winRatePct`/`wilsonLbPct`/`n`) and the identical doc-comment intent ("Same
gate/shape as archetypeTrackRecord above"). It is spread onto the returned `StructureLadder`
object identically to its sibling and unit-tested at the compute layer
(`play-brief-ladder.test.ts`), but `BieStructureLadder.tsx` renders `ladder.archetypeTrackRecord`
in full and jumps straight to `ladder.riskTheOtherSide` — `ladder.subLaneTrackRecord` was never
referenced anywhere in `src`. The moment a sub-lane bucket graduates in production, a member sees
the archetype's historical win rate but silently never the sub-lane's.

**`rung.meta`** — `collectFocalLevels()` (`play-brief-narrative.ts`) builds a human-readable
dark-pool context string (`"${pct}% of DP volume · ${premium}"`) for dark-pool focal levels;
`buildStructureLadder()` forwards it onto `StructureLadderRung.meta` unchanged. `LadderRow` (the
rung renderer) reads `price`/`distancePct`/`role`/`label`/`target.*` but never `rung.meta` — the
one grep hit for "meta" in the file is an unrelated CSS class name on a wrapper span, not the data
field.

## Evidence (RED → GREEN)

New test file `src/features/largo/answer/BieStructureLadder.test.ts` (no prior test file existed
for this component), using the repo's existing `renderToStaticMarkup` component-test pattern
(`LargoCompareCard.test.ts`):

- `subLaneTrackRecord` renders when present (RED: absent from output; GREEN: present) — plus a
  "renders both together" case and an "absent → no sub-lane block" regression guard.
- `rung.meta` renders when present (RED: absent from output; GREEN: present) — plus a "no meta →
  no empty placeholder" regression guard.

Pre-fix (RED, confirmed by stashing just the component file): 3 of 5 new tests fail. Post-fix
(GREEN): 5/5. `npx tsc --noEmit` clean.

## Blast radius

Both fields are additive renders inside `BieStructureLadder.tsx`'s existing JSX — no existing
block, prop, or CSS rule was changed. Added two small CSS rules (`src/app/globals.css`):
`.bie-ladder-row-extra` (secondary metadata text, matching the row's existing `.bie-ladder-row-dist`
sizing) and `.bie-ladder-track-record-sublane` (a small top margin so the archetype and sub-lane
blocks don't collide when both graduate simultaneously).

## Fix rationale

Mirrored the sibling `archetypeTrackRecord` block's exact structure for `subLaneTrackRecord`, and
inserted `rung.meta`'s render inside the existing `bie-ladder-row-meta` wrapper, between the label
and the distance chip — the natural reading order for "what is this level, any extra context,
how far, what kind."
