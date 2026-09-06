# Swing play-brief C1/C3 contract gaps — FIXED

> **kind:** FINDING

## Summary

Three small Largo contract violations in the Night Hawk Swings play-brief pipeline surfaced during the standing Ask Largo audit.

| Issue | Contract | Status |
|-------|----------|--------|
| CLOSED `exitAt` printed raw UTC ISO | C1 TIME | **FIXED** |
| `vectorFetchFailed` chip when `ecosystem.vector_full_state` present | C3 ABSENCE | **FIXED** |
| Meridian peer cohort failure collapsed to `null` | C3 ABSENCE | **FIXED** |

## Root cause

1. **exitAt:** #4244 fixed `markAsOf` and `scanAsOf` ET stamps but `closedSection` still echoed `play.exitAt` verbatim.
2. **Vector false positive:** #4249 added `vectorFetchFailed` absence without checking the parallel ecosystem fallback (`vectorOf` already prefers `ecosystem.vector_full_state`).
3. **Meridian peer:** `fetchMeridianPeerForBrief` returned `null` on `available: false`, discarding honest absence semantics from `loadMeridianPeerCohortForLargo`.

## Fix

- `play-brief.ts`: `etStampFromIso(play.exitAt)` in Outcome section.
- `play-brief-absence.ts`: gate Vector chip; surface `meridianPeer.available === false`.
- `play-brief-meridian-peer.ts`: preserve failure object instead of `null`.

## Evidence

`npx tsx --test src/lib/swing/play-brief.test.ts src/lib/swing/play-brief-absence.test.ts` — new regression tests pass.
