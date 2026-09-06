# Swing play-brief fabricated confidence — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **ID** | BO-P2-LARGO-001 |
| **Priority** | P2 |
| **Area** | Night Hawk Swings / Ask Largo |
| **Status** | FIXED |

## Symptom

`composeSwingPlayBrief()` always set `envelope.confidence` to `"high"` or `"moderate"` based on a coarse `hasRichData` boolean. The Largo product contract (C6) requires omitting confidence when the lane cannot calibrate it — fabrication corrupts cross-product ranking.

## Root cause

`src/lib/swing/play-brief.ts` passed an explicit uncalibrated `confidence` block into `buildRichEnvelope()`. The shared `buildRichEnvelope()` helper also defaulted missing confidence to `"high"`, so omission alone was insufficient.

## Fix

- Remove fabricated confidence from the swing play-brief composer.
- Stop `buildRichEnvelope()` from defaulting confidence when callers omit it (concept answers still pass explicit confidence).

## Evidence

- `npx tsx --test src/lib/swing/play-brief.test.ts` — new test `omits envelope.confidence (Largo C6)` GREEN.

## Blast radius

- Swing play-brief API + markdown export: confidence field now absent (deck view already stripped it).
- Concept/glossary answers: unchanged (still pass explicit confidence).
