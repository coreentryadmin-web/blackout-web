# Largo swing brief — stale GEX-only levels in watchForSection — FIXED

> **kind:** `FINDING`

| Field | Value |
|-------|-------|
| **ID** | BO-P2-largo-gex-stale-watch-for |
| **Pri** | P2 |
| **Area** | Night Hawk Swings / Ask Largo |
| **Status** | FIXED |

## Symptom

`watchForSection()` ("What to watch" / "Watch levels") cited gamma flip and put/call wall levels from `eco.gex_positioning` with no staleness gate when Vector data was absent — same Largo C2 gap fixed in #4360/#4364 for counter-thesis and gexPostureSection.

## Fix

Per-side stale GEX gating (mirrors #4364): suppress flip/wall lines when the value came from a stale GEX-only fallback; live Vector-sourced levels still render.

## Evidence

`npx tsx --test src/lib/swing/play-brief-intel.test.ts` — two new stale-parity cases pass.

| **Status** | FIXED — PR opened, merge pending CI/peer-review |
