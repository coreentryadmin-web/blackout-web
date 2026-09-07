# Ask Largo swing brief — CLOSED plays show nothing but stale live-desk "Unavailable" chips — FIXED

> **kind:** `FINDING`

| Field | Value |
|-------|-------|
| **ID** | BO-P1-swing-closed-play-brief-unavailable-noise |
| **Pri** | P1 |
| **Area** | Night Hawk Swings / Ask Largo |
| **Status** | FIXED |

## Symptom (user-reported, live production)

Operator screenshot of the live Swings board, CLOSED tab, AAPL 327.5C 5DTE (closed 2026-09-04,
-56.2%): the "ASK LARGO · LIVE INTELLIGENCE" panel showed **six stacked "Unavailable" chips and
nothing else** — HELIX flow pipeline stale, Vector heatmap/dark pool "not present on this read",
Vector snapshot stale, prior-session swing discovery scan, prior-session Night Hawk edition. User:
*"check why this is all empty values?? and fix the issues."*

## Root cause

`collectBriefUnavailableSources()` (`src/lib/swing/play-brief-absence.ts`) is called
unconditionally by `composeSwingPlayBrief()` regardless of the play's `statusBucket` (watch/open/
closed) — unlike `closedSection()`/`thesisHealthSection()`/`managementSection()` elsewhere in
`play-brief.ts`, which are already bucket-gated. Every check inside it that measures "is TODAY's
live desk state fresh/current" (HELIX flow freshness, GEX/Vector staleness + desk-state presence,
Vector section absences, open-book ledger read, and the three prior-session mismatch checks —
swing discovery scan, 0DTE Command, Night Hawk swings) compares against `ctx.sessionDate`, which
`play-brief-context.ts` always computes as **today's** ET session date at request time — never the
CLOSED play's own historical session. For a play that closed on an earlier session, every one of
these checks is individually honest but **permanently true once any time has passed since close**:
today's live desk state is never "current" relative to a play that finished days or weeks ago. The
result is a wall of true-but-unhelpful negative chips with zero positive content — exactly what
the screenshot shows.

## Fix

Gate every live-desk-freshness/session-currency check in `collectBriefUnavailableSources()` behind
`isClosed = ctx.play?.status === "CLOSED"`, skipping them for closed plays: HELIX flow staleness,
GEX cold-matrix/staleness, Vector desk-state absence/section-absences/staleness, open-book ledger
failure, and the three prior-session mismatch chips (swing discovery scan, 0DTE Command, Night
Hawk swings). **Genuine fetch failures are NOT skipped** — `ecosystemFetchFailed`,
`vectorFetchFailed`, and `meridian?.unavailable` still surface for closed plays, since those
indicate the read itself broke (still true after close), not merely that today's data doesn't
apply to a historical row. The `option mark` check and the `thesis health` uncalibrated check were
already implicitly closed-safe (both already gated to `OPEN`/`HOLD`/`TRIM` via
`playExpectsLiveOptionMark`/an explicit status allowlist) and needed no change.

## Blast radius

Single call site (`composeSwingPlayBrief` → `collectBriefUnavailableSources`), so every CLOSED
swing play's Ask Largo panel benefits — no other consumer of `collectBriefUnavailableSources`
exists.

## Evidence

`npx tsx --test src/lib/swing/play-brief-absence.test.ts` — 41/41 pass, including two new
regression cases: a CLOSED play with every live-desk check firing (HELIX stale, cold GEX, missing
Vector desk state, stale Vector snapshot, Vector section absences, open-book failure, stale
discovery scan, stale 0DTE, stale Night Hawk edition) now returns an **empty** unavailableSources
list; a CLOSED play with genuine `ecosystemFetchFailed`/`vectorFetchFailed`/`meridian.unavailable`
still surfaces those three. `npx tsx --test src/lib/swing/play-brief.test.ts
src/lib/swing/play-brief-intel.test.ts src/lib/swing/play-brief-narrative.test.ts
src/lib/swing/play-brief-narrative-coaching.test.ts` — 160/160 pass (composer-level regression).
`npx tsc --noEmit -p .` — clean.

| **Status** | FIXED — PR opened, merge pending CI/peer-review |
