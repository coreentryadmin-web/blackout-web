# Swing Ask Largo — Meridian absence + Vector cross-desk friction

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Area** | Night Hawk Swings / Ask Largo |
| **PR** | #TBD |

## Symptom

1. When Meridian timeline fetch failed, prose correctly said "calendar unavailable" but `envelope.unavailableSources` stayed empty — Largo C3 violation; `UnavailableChip` could not surface the gap.
2. `crossDeskCoaching` named Night Hawk, 0DTE, and HELIX friction but never Vector, even though Vector is loaded on every brief. `vectorPlayCoaching` used thesis substring matching (`"long"` in "Long gamma") and falsely read alignment.

## Fix

- `collectBriefUnavailableSources`: push `{ source: "Meridian catalysts", reason: "timeline read failed" }` when `ctx.meridian?.unavailable`.
- `crossDeskCoaching`: detect Vector `play.bias` long/short conflicts with swing direction.
- `vectorPlayCoaching`: align on `vp.bias` instead of thesis substring.

## Evidence

`npx tsx --test src/lib/swing/play-brief-absence.test.ts src/lib/swing/play-brief-narrative-coaching.test.ts` — all GREEN.
