# Largo swing brief: Meridian peer insufficient_reason computed but not surfaced — FIXED

> **kind:** `FINDING`

| Field | Value |
|-------|-------|
| **ID** | BO-P2-largo-meridian-peer-cohort |
| **Pri** | P2 |
| **Area** | Night Hawk Swings / Ask Largo |
| **Status** | FIXED in PR (pending merge) |

## Symptom

`loadMeridianPeerCohortForLargo` can return `available: true` with `insufficient_reason` when the implied-move cohort is thin. Beat-rate snippets were still shown without cohort context — Largo C8 violation.

## Fix

- `meridianPeerEarningsCoaching()` appends thin-cohort caveat when `insufficient_reason` is set.
- `collectBriefUnavailableSources()` surfaces the reason on the structured C3 channel.

## Evidence

`npx tsx --test src/lib/swing/play-brief-meridian-peer.test.ts` — 6/6 pass.
