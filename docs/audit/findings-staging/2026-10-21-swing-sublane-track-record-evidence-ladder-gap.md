## 2026-10-21 — [FINDING, swing] Sub-lane track-record evidence never reached `evidence[]` or the Structure Ladder — archetype-only, while the prose section already covers both

> **kind:** `FINDING`

| Field | Value |
| --- | --- |
| **Status** | FIXED |
| **Severity** | P3 (Largo C10 historical-context completeness — the brief's own prose/table says something two structured consumers of the same envelope can't see) |
| **Surface** | `src/lib/swing/play-brief.ts` (evidence[] feeder), `src/lib/swing/play-brief-ladder.ts` (Structure Ladder widget) |

### Root cause

`archetypeTrackRecordSection` (`play-brief-intel.ts`) independently resolves and gates BOTH the
ARCHETYPE dimension (`graduatedArchetypeEntry`) and the SUB-LANE dimension (`graduatedSubLaneEntry`,
TACTICAL/STANDARD) from the same `calibration-cache.ts` snapshot, rendering either/both as separate
paragraphs — its own tests prove a sub-lane-alone graduation (archetype ungraduated or unclassified)
is a real, deliberately-supported state.

Two other consumers of the identical snapshot were never extended past the archetype-only citation
shipped on 2026-09-20/2026-10-15:

1. `play-brief.ts`'s Largo-C10 `evidence[]` feeder imports only `graduatedArchetypeEntry` and pushes
   one `"Archetype track record: ..."` fact — no parallel `graduatedSubLaneEntry` call.
2. `play-brief-ladder.ts`'s Structure Ladder `trackRecordFor` likewise only ever calls
   `graduatedArchetypeEntry`.

A 2026-10-15 FINDINGS entry that added a structured `table` field to the prose section's own
`RichSection` explicitly noted it was NOT propagating to other consumers ("No other caller of
`graduatedArchetypeEntry` or the snapshot shape changed") — a deliberate scoping choice at the time,
never adjudicated as a permanent design decision, and never closed afterward.

### Evidence

Live repro (SEDG WAIT-bucket play-brief, Ask Largo deep-dive, 2026-10-21): the archetype bucket was
ungraduated/unclassified, but the brief's own prose rendered a real sub-lane citation — for which
neither `envelope.evidence[]` nor the Structure Ladder's `archetypeTrackRecord` field carried
anything.

Verified directly: `play-brief.ts:22` imports only `graduatedArchetypeEntry` (confirmed
`graduatedSubLaneEntry` exists in `calibration-cache.ts` with the identical `(snapshot, dimension) ->
SwingTrackRecordEntry | null` shape and `graduated===true` gating); `play-brief-ladder.ts`'s
`trackRecordFor` likewise never calls it. `play-brief-intel.test.ts:605-627` confirms the
sub-lane-alone case is real and tested there.

Added regression tests:
- `play-brief.test.ts`: a sub-lane-graduated/archetype-ungraduated fixture asserting a
  `"Sub-lane track record: ..."` fact now appears in `evidence[]` (and that no archetype fact is
  fabricated for the ungraduated dimension), plus the sibling absence/ungraduated-omission cases.
- `play-brief-ladder.test.ts`: the identical fixture shape asserting the Structure Ladder's new
  `subLaneTrackRecord` field is now populated (`archetypeTrackRecord` correctly absent), plus
  ungraduated/cold-cache omission cases.

RED→GREEN confirmed via `git stash` on the two source files: `play-brief.test.ts` +
`play-brief-ladder.test.ts` — 2 failures before, 193/193 pass after. Broader sweep
`play-brief*.test.ts`: 1129/1129 pass. `tsc --noEmit` clean.

### Blast radius

Two files, both purely additive — a new evidence fact and a new optional ladder field, both reusing
the already-fetched `ctx.archetypeTrackRecord` snapshot (no new async read, no latency cost). No
existing field, test, or rendering path was changed.

### Fix

Mirror the existing archetype pattern for the sub-lane dimension in both files:
- `play-brief.ts`: resolve `swingSubLane` from `ctx.play.subLane` against `SWING_SUB_LANES_ORDER`
  (the same narrowing `archetypeTrackRecordSection` uses), call `graduatedSubLaneEntry`, and push a
  parallel `"Sub-lane track record: ..."` evidence fact with the same freshness/provenance
  derivation already used for the archetype fact.
- `play-brief-ladder.ts`: add `StructureLadderSubLaneTrackRecord` (same shape as the existing
  archetype type, kept separate so each field's dimension is unambiguous to a consumer) and a
  sibling `subLaneTrackRecordFor` helper, wired into `buildStructureLadder`'s return alongside the
  existing `archetypeTrackRecord` field.

### Why not a bigger fix

Did not touch `archetypeTrackRecordSection`'s own prose/table rendering (already correct — it
already independently gates and cites both dimensions) or `calibration-cache.ts`'s gating functions
(already correct, already shared). Deliberately did NOT blend the two dimensions into one combined
stat in either new code path — that would double-count the same graded rows across two overlapping
cuts of the same population, exactly the thing the prose section's own header warns against.
