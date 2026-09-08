# Largo swing brief — prior-session 0DTE silent in unavailableSources — FIXED

> **kind:** `FINDING`

| Field | Value |
|-------|-------|
| **ID** | BO-P2-largo-zerodte-unavailable-c3 |
| **Pri** | P2 |
| **Area** | Night Hawk Swings / Ask Largo |
| **Status** | FIXED |

## Symptom

`zerodteLiveForSession()` (#4424) suppressed prior-session 0DTE direction in cross-desk prose, but
`collectBriefUnavailableSources()` never emitted a structured absence row when
`zerodte_today.session_date !== ctx.sessionDate`. Consumers reading `unavailableSources` / `UnavailableChip`
alone saw nothing wrong — same C3 gap already closed for swing discovery scan staleness.

## Fix

Emit `{ source: "0DTE Command", reason: "prior session (…) — today's board not yet run" }` when session
dates mismatch.

## Evidence

`npx tsx --test src/lib/swing/play-brief-absence.test.ts` — prior-session C3 regression case passes.

| **Status** | FIXED — PR opened, merge pending CI/peer-review |
