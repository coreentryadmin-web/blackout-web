## 2026-09-06 — [FINDING, P1] Swing brief v4 collapse dropped book concentration entirely

> **kind:** `FINDING`

| Field | Value |
| --- | --- |
| **Status** | FIXED |
| **Surface** | `composeSwingPlayBrief` / brief v4 intel collapse |
| **Symptom** | `verify` red on `main@1c7149b9` — test expects concentration once, found 0 sections |
| **Root cause** | v4 `collapseRedundantIntelSections` removes dedicated "Book context" when Trade manager read leads, but `bookContextCoaching` was never wired into narrative bullets — overlap warning silently omitted |
| **Fix** | Shared `bookOverlapNarrativeLines` + `bookContextCoaching` in narrative; Book context section still collapsed when narrative present |
| **Evidence** | `play-brief.test.ts` concentration-once test; `play-brief-book-overlap.ts` |
