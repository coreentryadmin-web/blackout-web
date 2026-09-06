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
sections when pillar inputs are unwired — but **Verdict** still printed `Thesis strength 46%` via
`thesisStrengthPct()` without checking `thesisHealthUncalibrated()`.

(The diff-engine + coaching leaks are handled separately in #4329.)

## Fix

Gate Verdict thesis strength with `thesisHealthUncalibrated()` (Largo C6).

## Validation

- `npx tsx --test src/lib/swing/play-brief.test.ts` — Verdict assertion on uncalibrated row GREEN

## RTH check

OPEN/HOLD swing row with unwired pillars: Ask Largo Verdict must NOT show `Thesis strength N%`.
