> **kind:** FINDING

## `play-brief-intel-collapse.ts` doc comment said "Seven titles" after an eighth was added — FIXED

| **Status** | FIXED |
|---|---|
| **Severity** | P3 (doc-comment accuracy only — zero behavioral/runtime impact) |
| **Surface** | `src/lib/swing/play-brief-intel-collapse.ts` |
| **Found by** | 5-engine live monitor cycle, Ask Largo deep-dive sub-mandate |

### Root cause

`NARRATIVE_COVERED_TITLES`'s header doc comment ("Seven titles in this set are NOT
unconditionally covered") and an inline comment inside `collapseRedundantIntelSections`
("These seven are the conditionally-covered titles in the set") both still said "seven" after
commit `ad04f5f8f` (PR #7649, "GEX posture section gets the same opt-in fold check as its 7
siblings") added an eighth conditionally-covered title (`gexPostureFolded`). That commit correctly
updated one nearby summary line ("for all eight") but missed the two earlier "seven" references.

### Why it wasn't caught earlier

Purely prose — `collapseRedundantIntelSections`'s actual filter logic already checked all eight
titles with their own opts correctly; no section was ever mis-collapsed. The stale count only
misleads a future reader of the comment, not the running code.

### Fix

Changed both stale occurrences ("Seven titles" → "Eight titles", "These seven" → "These eight")
to match the actual eight-member set and the already-correct "for all eight" line a few lines
below.

### Evidence

No behavior to test — a pure comment-text fix. Confirmed via `grep -n "Seven titles\|These seven"
src/lib/swing/play-brief-intel-collapse.ts` returning no matches post-fix, and that the set
(`NARRATIVE_COVERED_TITLES`) and the opt-check branches in `collapseRedundantIntelSections` both
still enumerate exactly eight titles (Lane rank, Wall dynamics, Vector desk, Levels on chart,
Flow & positioning, Macro tape, Hold plan, GEX posture).

### Blast radius

Single file, comment-only. No other file references these two sentences.

### What was deliberately left unchanged

The actual filter logic and the already-correct "for all eight" sentence — only the two stale
"seven" references were touched.
