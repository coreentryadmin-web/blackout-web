# Ask Largo swing brief — intel collapse silently dropped book concentration (main verify RED)

> **kind:** FINDING

| | |
|---|---|
| **Status** | FIXED |
| **Severity** | P1 (CI blocker + member-visible missing concentration warning) |
| **Area** | Swing / Ask Largo play brief intel collapse |
| **Files** | `src/lib/swing/play-brief-intel-collapse.ts`, `src/lib/swing/play-brief-intel-collapse.test.ts` |

## Context

PR #4119 added `collapseRedundantIntelSections()` to dedupe intel sections already covered by
"Trade manager read". It correctly omits the standalone "Book context" section when a narrative
block is present — but only appended a generic "folded into Trade manager read" note. The actual
concentration body from `bookContextSection()` was discarded, so members with overlapping books
saw **zero** concentration warning after #4116 removed the duplicate coaching bullet and #4119
collapsed the dedicated section.

## Root cause

`NARRATIVE_COVERED_TITLES` included `"Book context"` with no special handling. Unlike GEX/levels
sections whose detail is already mirrored in narrative coaching, book concentration lived **only**
in `bookContextSection()` — collapsing it without folding the body silently removed the warning.

## Fix

When collapsing `"Book context"`, append its body into "Trade manager read" before the generic fold
note (`FOLD_BODY_INTO_NARRATIVE`). Other covered titles remain drop-only.

## Evidence (RED → GREEN)

`main@1c7149b92` verify RED on `play-brief.test.ts` line 309: expected exactly 1 section matching
`/concentration/i`, got 0. After fix: `play-brief.test.ts` + `play-brief-intel-collapse.test.ts`
9/9 pass (Node 20). New unit test asserts folded concentration text survives in narrative body.

## Blast radius

Only OPEN/WATCH briefs with both trade-manager narrative and book overlap. No API/schema change.
