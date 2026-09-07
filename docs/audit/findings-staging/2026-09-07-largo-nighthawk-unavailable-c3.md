# Largo swing brief — prior-session Night Hawk silent in unavailableSources — FIXED

> **kind:** `FINDING`

| Field | Value |
|-------|-------|
| **ID** | BO-P2-largo-nighthawk-unavailable-c3 |
| **Pri** | P2 |
| **Area** | Night Hawk Swings / Ask Largo |
| **Status** | FIXED |

## Symptom

`nighthawkLiveForSession()` (#4427) suppressed prior-session Night Hawk direction in cross-desk
prose, but `collectBriefUnavailableSources()` never emitted a structured absence row when
`nighthawk_recent.edition_for !== ctx.sessionDate`. Consumers reading `unavailableSources` /
`UnavailableChip` alone saw nothing wrong — same C3 gap already closed for swing discovery scan and
0DTE Command (#4428).

## Fix

Emit `{ source: "Night Hawk swings", reason: "prior session (…) — today's edition not yet run" }`
when edition dates mismatch.

## Evidence

`npx tsx --test src/lib/swing/play-brief-absence.test.ts` — prior-session C3 regression case passes.

| **Status** | FIXED — PR opened, merge pending CI/peer-review |
