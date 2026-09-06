# Swing book concentration vanished after intel collapse — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Severity** | P1 (CI verify red on main) |
| **Area** | `src/lib/swing/play-brief-intel-collapse.ts` |

## Symptom

`composeSwingPlayBrief: book concentration is reported ONCE` failed on main @ `1c7149b9` — concentration appeared in 0 sections.

## Root cause

#4116 removed duplicate `bookContextCoaching` from Trade manager read (correct). `collapseRedundantIntelSections` still dropped the dedicated **Book context** section whenever narrative was present, leaving no concentration anywhere.

## Fix

Remove `"Book context"` from `NARRATIVE_COVERED_TITLES` — it is the sole home for portfolio overlap after #4116.

## Evidence

- CI run `34012338410`: 1 fail / 12912 pass, test 9292
- `npx tsx --test src/lib/swing/play-brief.test.ts -t "book concentration"` — GREEN post-fix
