# Largo swing brief — stale GEX-only wall levels still steelman counter-thesis — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **ID** | BO-P2-largo-gex-stale-wall |
| **Pri** | P2 |
| **Area** | Night Hawk Swings / Ask Largo |
| **Status** | FIXED |

## Symptom

Same Largo C2 (freshness) gap #4355/#4360 fixed for dealer gamma posture, one more call site:
`counterThesisLine()`'s call-wall/put-wall steelman reasons (`counterThesisLine`,
`play-brief-narrative.ts`) read `eco.gex_positioning.call_wall`/`put_wall` with no staleness gate
at all when no live Vector wall was present — a >120s-old GEX matrix could still steelman
"call wall **X** overhead (Y%)" as a counter-thesis reason, same dishonesty class as citing stale
dealer posture as if live. Flagged by Cursor's peer review on #4360 as a non-blocking follow-up
("`counterThesisLine` still steelmans call_wall/put_wall from `eco.gex_positioning` without a
stale gate — same class of issue but separate from posture parity").

## Root cause

`counterThesisLine()` computed `callWall`/`putWall` via `vec?.gexWalls?...?.strike ?? eco?.gex_positioning?.call_wall`
(same fallback shape as the just-fixed `gamma_posture` read) but never checked `gexMatrixStale()`
before citing the wall as a live steelman reason.

## Fix

Gate each wall **independently** (not both-or-nothing): `callWallFromStaleGex`/`putWallFromStaleGex`
suppress the reason only when that specific wall came from the GEX-only fallback (no live Vector
wall for that side) AND the matrix is stale — mirrors the exact `postureFromGex`/`gexMatrixStale`
pattern #4360 used for posture. A live Vector-sourced wall on one side still steelmans even when
the other side falls back to a stale GEX read.

## Evidence

- RED→GREEN: two new tests confirm stale-GEX-only call/put wall no longer steelman; a third test
  confirms a live Vector wall still steelmans even when the GEX matrix is stale (proves the
  per-wall, not both-or-nothing, gating).
- `npx tsc --noEmit`: clean.
- `src/lib/swing/play-brief-narrative.test.ts`: 18/18 pass.
- `src/lib/swing/*.test.ts` (full suite): 738/738 pass.

## Blast radius

Single function (`counterThesisLine`), same file already touched by #4355/#4360.
