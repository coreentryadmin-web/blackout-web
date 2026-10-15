> **kind:** FINDING

## Swing play-brief `archetypeTrackRecordSection` dropped lane-wide graded-play context — FIXED

| | |
|---|---|
| **Status** | FIXED |
| **Severity** | P4 — minor enhancement, not a correctness bug (the bucket's own n/W/L/Wilson-LB were already correct) |
| **File** | `src/lib/swing/play-brief-intel.ts` (`archetypeTrackRecordSection`) |
| **Found by** | Workflow-based "dead-wired data" hunt, Ask Largo × Night Hawk Swings standing ownership mandate, 2026-10-15 |

### Root cause

`SwingArchetypeTrackRecordSnapshot.gradedPlays` (`calibration-cache.ts`) is the whole-lane graded-play
count at write time, documented on the type itself: "context for how broad the evidence base is
overall, independent of any one bucket's own `n`." `archetypeTrackRecordSection` receives the full
`snapshot` object but only ever forwarded it into `graduatedArchetypeEntry(snapshot, archetype)` /
`graduatedSubLaneEntry(snapshot, subLane)` — it never read `gradedPlays` itself when building the
section. A member reading "across 12 graded plays" on a thin archetype bucket had no way to tell if
that was 12 of a lane with 70 total graded plays, or 12 of a lane with only 15 — exactly the context
this field exists to supply, and not gated by any absence/degraded comment.

### Evidence

New regression test (`play-brief-intel.test.ts`). Pre-fix (RED, verified via `git stash` isolation):
body never mentioned the lane-wide count. Post-fix (GREEN): body states "Across 70 lane-wide graded
plays as of this read."

### Fix

Appended one line to the section's body, gated on `snapshot` being present (it always is when this
section renders at all, since both graduation lookups already require it). No change to the existing
per-bucket prose, table, or computed entries.

### Blast radius

Single call site — `archetypeTrackRecordSection` only called from `buildIntelSections` in the same
file.
