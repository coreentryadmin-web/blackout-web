# Ask Largo swing brief — CLOSED plays still show live-desk staleness prose — FIXED

> **kind:** `FINDING`

| Field | Value |
|-------|-------|
| **ID** | BO-P1-swing-closed-brief-narrative-noise |
| **Pri** | P1 |
| **Area** | Night Hawk Swings / Ask Largo |
| **Status** | FIXED |

## Symptom

Follow-up to #4461: after gating `collectBriefUnavailableSources()` for CLOSED plays, the Ask Largo
panel could still show live-desk staleness **prose** (Data freshness, GEX posture, Flow intel, Book
context, Watch for) because `buildIntelSections()` always rendered those sections regardless of
`statusBucket`.

## Root cause

`buildIntelSections()` had no bucket gate on live-desk narrative sections. Individual helpers like
`dataFreshnessSection()` and `gexPostureSection()` compare today's desk state against
`ctx.sessionDate` — permanently true for historical CLOSED rows.

## Fix

Gate live-desk narrative sections behind `bucket !== "closed"` in `buildIntelSections()`, mirroring
#4461's unavailableSources gating. Outcome/lessons/narrative sections remain for CLOSED plays.

## Evidence

`npx tsx --test src/lib/swing/play-brief-intel.test.ts` — 52/52 pass including new CLOSED regression.
`npx tsc --noEmit` — clean.

| **Status** | FIXED — PR opened, merge pending CI/peer-review |
