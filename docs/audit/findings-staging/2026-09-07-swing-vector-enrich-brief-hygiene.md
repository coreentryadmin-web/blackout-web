# Swing vector enrich + play-brief hygiene — FIXED

> **kind:** `FINDING`

| Field | Value |
|-------|-------|
| **ID** | BO-P2-swing-vector-enrich-brief-hygiene |
| **Pri** | P2 |
| **Area** | Night Hawk Swings / Ask Largo |
| **Status** | FIXED |

## Symptoms (CTO audit 2026-09-06 items #55–#57)

1. `enrichPlayWithVectorLeader` fabricated a +3 score bump when `peakPremiumPct` was null — uncalibrated conviction on the desk card.
2. `whyThisSetupSection` duplicated archetype/regime already rendered in Verdict.
3. `briefContentKey` JSON-stringified raw IEEE floats, evading route-level `roundFloats()`.

## Fix

- Vector enrich: tag `VECTOR` when leader matches; score bump only when `peakPremiumPct` is finite.
- Why-this-setup: keep sub-lane; drop archetype/regime (Verdict owns them).
- `briefContentKey`: `roundFloats()` the payload before `JSON.stringify`.

## Evidence

- `npx tsx --test src/lib/swing/vector-lane-enrich.test.ts` — 3/3 pass.
- `npx tsx --test src/lib/swing/play-brief-intel.test.ts` — archetype dedupe regression.
- `npx tsx --test src/lib/swing/play-brief-diff.test.ts` — briefContentKey rounding.

| **Status** | FIXED — PR opened |
