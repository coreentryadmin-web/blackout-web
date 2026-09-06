# Largo stale Vector desk section bias badges directional read off stale snapshot

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Status** | FIXED (PR pending) |
| **Area** | Night Hawk Swings / Ask Largo |
| **Contract** | Largo C2 (freshness / absence) |

## Symptom

`vectorDeskSection()` in `play-brief-intel.ts` stamped the intel card `bias` chip from `vec.play.bias` even when the Vector snapshot was stale (>120s / `freshness: "stale"`). Coaching paths were gated in #4387; the Vector desk intel card was not.

## Root cause

`bias` derived directly from `p.bias` with no `vectorSnapshotStale()` gate — same class as pre-#4387 `crossDeskCoaching` / `vectorPlayCoaching`.

## Fix

Gate `vectorDeskSection` bias with `vectorSnapshotStale()`; stale → `neutral` (headline/invalidation body still shown; directional badge omitted).

## Evidence

- `npx tsx --test src/lib/swing/play-brief-intel.test.ts` — new regression tests pass
- `npx tsc --noEmit` — clean
