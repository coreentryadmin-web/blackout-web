# Largo swing brief — Meridian peer cohort buried in narrative cap

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **ID** | BO-P1-largo-peer-section-2026-09-06 |
| **Status** | FIXED |
| **Area** | Night Hawk Swings / Ask Largo |
| **PR** | fix/largo-meridian-peer-section |

## Symptom

`fetchMeridianPeerForBrief()` loads sector peer beat-rate cohort on earnings plays, but the only consumer was `meridianPeerEarningsCoaching()` — a single bullet inside `collectCoachingBullets()`. When Vector/GEX coaching filled `MAX_BULLETS` (14), peer earnings history could be silently dropped despite live data on the read.

## Fix

Add `meridianPeerSection()` in `play-brief-intel.ts` and wire it into `buildIntelSections()` after Meridian catalysts. Section title **Earnings peer lens** is outside `NARRATIVE_COVERED_TITLES`, so collapse logic cannot remove it.

## Evidence

- `npx tsx --test src/lib/swing/play-brief-intel.test.ts` — new section + index-skip cases pass.
