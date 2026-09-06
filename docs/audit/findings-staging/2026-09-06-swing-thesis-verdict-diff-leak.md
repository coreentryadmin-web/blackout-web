# Swing play brief — uncalibrated thesis % still leaked in Verdict + diff engine — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Priority** | P1 |
| **Area** | Night Hawk Swings / Ask Largo (C6/C7) |
| **PR** | (this branch) |

## Symptom

#4318 withheld the aggregate thesis-health % from Thesis health, hold plan, and trade-manager
sections when pillar inputs are unwired — but **Verdict** still printed `Thesis strength 46%`, and
the "What changed" diff engine could narrate `Thesis health shifted 48% → 51%` from the same
fabricated composite.

## Root cause

`thesisStrengthPct()` was called without the `thesisHealthUncalibrated()` guard, and
`snapshotFromBrief()` always snapshotted raw `thesisHealth.health` for diffing.

## Fix

- Gate Verdict thesis strength with `thesisHealthUncalibrated()`.
- Null `thesisHealth` in brief snapshots when uncalibrated so `diffBriefSnapshots` skips
  `narrateThesisShift`.

## Validation

- `npx tsx --test src/lib/swing/play-brief.test.ts`
- `npx tsx --test src/lib/swing/play-brief-diff.test.ts`

## RTH check

OPEN/HOLD swing row with unwired setup/entry/signal pillars: Ask Largo Verdict must NOT show
`Thesis strength N%`; refresh must NOT emit thesis-health shift lines when only the default
composite drifts.
