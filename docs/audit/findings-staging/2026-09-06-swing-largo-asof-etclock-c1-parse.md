# Swing Ask Largo deck "Updated — ET" — etClock could not parse Largo C1 asOf

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Severity** | P2 |
| **Area** | Night Hawk Swings / Ask Largo |
| **PR** | (pending) |

## Symptom

Night Hawk Swing deck rail showed `Updated — ET` (em-dash) instead of a wall-clock time after #4142 stamped `play-brief` `asOf` with Largo C1 format (`YYYY-MM-DD HH:mm ET`).

## Root cause

`SwingLargoInsightsPanel` renders `etClock(asOf)` from `@/lib/et-clock`, whose `toMs()` used `Date.parse()`. `Date.parse("2026-09-05 16:00 ET")` is `NaN`, so `etClock` returned null and the UI fell back to `—`.

## Fix

- Added `parseEtStamp()` inverse of `etStamp()` in `bar-session-date.ts` (round-trip via EDT/EST offset probe).
- `et-clock.ts` `toMs()` falls back to `parseEtStamp()` when ISO parse fails.

## Verify at RTH

Select any OPEN swing play on Night Hawk → Ask Largo rail should read e.g. `Updated 4:00 PM ET`, not `Updated — ET`.
