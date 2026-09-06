# Largo swing brief — short interest missing from envelope.evidence (C7)

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Area** | Night Hawk Swings / Ask Largo |
| **Severity** | P2 |
| **PR** | (pending) |

## Symptom

Swing play-brief rendered short interest (DTC, short vol ratio) in Catalysts prose and coaching
sections, but `envelope.evidence[]` had no structured row. Largo's evidence rail and cross-product
joins read `envelope.evidence`, not markdown bodies — same failure mode #4311 fixed for HELIX flow
premiums hours earlier on the same day.

## Root cause

`evidenceFromContext()` in `src/lib/swing/play-brief.ts` wired scan, mark, HELIX flow, and earnings
but omitted `arsenal.fundamentals` short-interest fields even when present upstream.

## Fix

Emit a `Short interest: DTC … · short vol ratio …` evidence fact with `provenance.asOf` from
`fundamentals.as_of` (C1 cohort date) and source `Polygon / Benzinga`.

## Regression test

`composeSwingPlayBrief: short interest evidence grounds Catalysts claims for Largo C7` in
`src/lib/swing/play-brief.test.ts`.
