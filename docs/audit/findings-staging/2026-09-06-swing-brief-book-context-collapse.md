# Swing brief — book concentration silently dropped after #4119 collapse

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Status** | FIXED (PR pending) |
| **Priority** | P1 |
| **Area** | Night Hawk Swings / Ask Largo play-brief |
| **Discovered** | 2026-09-06 (Claude triage on #4119) |

## Symptom

After #4119 merged `collapseRedundantIntelSections()`, OPEN plays with theme-overlapping books showed **zero** concentration warning anywhere when Trade manager read was present. The collapse footnote falsely claimed detail was "folded into Trade manager read above."

## Root cause

`NARRATIVE_COVERED_TITLES` included `"Book context"`, assuming a narrative bullet covered concentration. #4116 had removed duplicate `bookContextCoaching()` — the dedicated `bookContextSection()` is now the **only** source. Collapse deleted it with no replacement.

## Fix

Remove `"Book context"` from `NARRATIVE_COVERED_TITLES`. Regression: existing `play-brief.test.ts` book-concentration test (RED pre-fix) + new unit test in `play-brief-intel-collapse.test.ts`.

## RTH validation

On `/nighthawk` Swings OPEN tab, select a play whose theme overlaps an existing book position — **Book context** section must appear once; Trade manager read must not duplicate concentration language.
