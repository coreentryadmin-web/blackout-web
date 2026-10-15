> **kind:** FINDING

## Swing play-brief "What changed" diff never caught a shrinking/shifting gate-block set — FIXED

| | |
|---|---|
| **Status** | FIXED |
| **Severity** | P3 — a materially actionable fact ("only 1 gate left blocking entry") was invisible to the live diff pulse |
| **File** | `src/lib/swing/play-brief-diff.ts` (`BriefSnapshot`, `snapshotFromBrief`, `diffBriefSnapshots`, `loadPersistedBriefSnapshot`) |
| **Found by** | Workflow-based "dead-wired data" hunt, Ask Largo × Night Hawk Swings standing ownership mandate, 2026-10-15 |

### Root cause

`BriefSnapshot` had no field for `TerminalPlay.gateBlocks` (the gates currently blocking entry on a
WATCH play). `snapshotFromBrief` built the snapshot straight from `play` but never read
`play.gateBlocks`, and `diffBriefSnapshots` had no code path referencing gate blocks anywhere.

For a WATCH play, `gateBlocks` is recomputed fresh every discovery cycle and can narrow (gates
clearing one at a time) or shift to a different binding gate — a real, previously-observed
production shape (`entry-verdict.ts`'s own comment cites a live MU repro with 3 active commit gates
narrowing independently session to session). But narrowing the gate list (e.g. 3 blocking gates → 1,
still net-blocked) produced **no change anywhere else the diff engine checks**:
`recommendation` for a WATCH play only flips BUY once ALL gates clear (not when the set merely
shrinks), and the headline's action-label component stays "WAIT" regardless of gate count/codes. So
a real, materially actionable fact — "only 1 gate left blocking entry" vs "3 gates", or a different
gate now being the binding one — could change session-to-session for the same WATCH play and produce
zero "What changed" lines, the same "silently identical to a refresh where nothing happened" shape
this file's own comments already fixed for `rollCandidateReason`, headline-DTE, and section
add/remove — just not caught for this field.

### Evidence

New regression tests (`play-brief-diff.test.ts`). Pre-fix (RED, verified via `git stash` isolation):
a gate set narrowing from 3 codes to 1, or a new gate appearing, or a gate set clearing to zero
alongside a recommendation flip, all produced no "Entry gates shifted" line. Post-fix (GREEN): all
three narrate correctly, a same-set-different-order comparison correctly does NOT re-narrate
(order-independent), and a `sessionStorage`-persisted snapshot predating this field is correctly
rejected rather than crashing `diffBriefSnapshots`'s new `.join(",")` call (the same
`loadPersistedBriefSnapshot` guard shape already in place for `sectionTitles`, extended here).

### Fix

Added `gateBlocks: string[]` (sorted codes, order-independent comparison) to `BriefSnapshot`,
populated from `play?.gateBlocks` in `snapshotFromBrief`, diffed in `diffBriefSnapshots` (narrates
added/cleared codes and the before/after count — fires even when the set clears to zero alongside a
recommendation flip, since the two lines state different things and neither makes the other
redundant), and added the same missing-field rejection guard to `loadPersistedBriefSnapshot` that
already protects `sectionTitles`.

### Blast radius

`BriefSnapshot` is constructed in exactly one place (`snapshotFromBrief`) and consumed by
`diffBriefSnapshots`, `briefContentKey` (unchanged — deliberately excludes several existing fields
including `rollCandidateReason`, so `gateBlocks` was not added there either, keeping this fix scoped
to the diff-narration gap only), and `loadPersistedBriefSnapshot`/`persistBriefSnapshot`
(`useSwingPlayBrief.ts`). No other file constructs a `BriefSnapshot` literal.
