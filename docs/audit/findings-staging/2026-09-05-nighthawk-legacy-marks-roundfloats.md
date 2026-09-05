# Night Hawk legacy-marks API missing roundFloats — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **ID** | BO-P2-legacy-marks-roundfloats |
| **Status** | FIXED (pending merge) |
| **Area** | Night Hawk / API boundary |
| **PR** | fix/nighthawk-legacy-marks-roundfloats |

## Symptom

`/api/market/nighthawk/legacy-marks` returned raw IEEE float noise on `mark`/`bid`/`ask` while sibling Night Hawk routes (`edition`, `horizons`, `play-bars`) already wrap responses in `roundFloats`.

## Root cause

The legacy-marks cache-reader route was added without the repo-wide API-boundary rounding policy applied at `NextResponse.json`.

## Fix

Wrap the success payload with `roundFloats({ available: true, marks })` before serializing. Source-scan regression test in `route.test.ts`.

## Evidence

- `play-bars` fixed separately in #3814; this completes the Night Hawk float-boundary sweep for legacy edition marks.
- `npx tsx --test src/app/api/market/nighthawk/legacy-marks/route.test.ts` GREEN.
