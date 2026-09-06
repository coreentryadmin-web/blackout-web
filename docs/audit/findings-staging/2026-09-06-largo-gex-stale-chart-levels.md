# Largo swing brief — stale GEX-only levels in chartLevelsSection — FIXED

> **kind:** `FINDING`

| Field | Value |
|-------|-------|
| **ID** | BO-P2-largo-gex-stale-chart-levels |
| **Pri** | P2 |
| **Area** | Night Hawk Swings / Ask Largo |
| **Status** | FIXED |

## Symptom

`chartLevelsSection()` ("Levels on chart") cited call wall, put wall, gamma flip, and GEX king strike from `eco.gex_positioning` with no staleness gate when Vector data was absent — same Largo C2 class fixed in #4360/#4364/#4367 for other sections.

## Fix

Per-side stale GEX gating (mirrors #4364/#4367): suppress flip/wall/king lines when the value came from a stale GEX-only fallback; live Vector-sourced levels still render.

## Evidence

`npx tsx --test src/lib/swing/play-brief-intel.test.ts` — two new stale-parity cases pass.

| **Status** | FIXED — PR opened, merge pending CI/peer-review |
