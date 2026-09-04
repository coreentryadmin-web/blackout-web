# 2026-09-04 — Vector volume-profile POC/VAH/VAL labels collide with price-line axis badges

> **kind:** `FINDING`

## Symptom

On SPX Slayer `/dashboard`, the volume-profile "POC" label was painted under the orange "Pin" native axis badge whenever both levels landed near the same price — POC text unreadable.

## Root cause

`VolumeProfilePrimitive` drew labels at `rightX - 6` (flush to the price axis) while lightweight-charts price-line axis badges occupy the same right-edge band.

## Fix

Anchor POC/VAH/VAL labels at `gutterLeft + 4px` with left text alignment — inside the profile bar band, away from axis badges. Pure helper `volumeProfileLabelX()` + regression test.

## Status

FIXED in PR.
