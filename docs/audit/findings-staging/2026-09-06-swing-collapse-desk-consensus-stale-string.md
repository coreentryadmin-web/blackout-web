# Swing brief collapse — stale "Desk consensus" string in NARRATIVE_COVERED_TITLES

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Area** | Night Hawk Swings / Ask Largo |
| **PR** | (pending) |

## Symptom

`play-brief-intel-collapse.ts` listed `"Desk consensus"` in `NARRATIVE_COVERED_TITLES`, but #4111 renamed the section to `"Desk context"`. The stale string never matched, so Desk context was accidentally safe — not by design.

## Root cause

Section rename in `deskConsensusSection()` (`play-brief-intel.ts`) was not mirrored in the collapse allowlist. A future rename back to "Desk consensus" would reintroduce silent section drops.

## Fix

Removed the dead `"Desk consensus"` entry. Documented why `"Book context"` and `"Desk context"` must stay visible. Added regression test asserting Desk context survives collapse when narrative leads.

## Evidence

`node --import tsx --test src/lib/swing/play-brief-intel-collapse.test.ts` — 4/4 pass.
