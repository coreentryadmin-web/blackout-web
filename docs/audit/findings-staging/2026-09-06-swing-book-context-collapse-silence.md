> **kind:** FINDING

# Swing brief v4 collapsed Book context after narrative duplicate was removed — FIXED

| **Status** | FIXED |
|------------|-------|
| **Pri** | P1 |
| **Area** | `play-brief-intel-collapse.ts` — G-S4 / Ask Largo book concentration |

## Symptom

`main` verify RED: `composeSwingPlayBrief: book concentration is reported ONCE` found **0** sections with concentration text (expected 1).

## Root cause

#4116 removed duplicate `bookContextCoaching` from the Trade manager narrative (correct). #4119 brief v4 still listed `"Book context"` in `NARRATIVE_COVERED_TITLES`, so `collapseRedundantIntelSections` dropped the dedicated `bookContextSection` whenever a narrative existed — with nothing left to report theme overlap.

## Fix

Stop collapsing `"Book context"` — concentration lives only in the dedicated section now.

## Evidence

- `play-brief.test.ts` RED on `origin/main` @ `1c7149b92`, GREEN post-fix.
- `play-brief-intel-collapse.test.ts` asserts Book context survives collapse when narrative leads.
