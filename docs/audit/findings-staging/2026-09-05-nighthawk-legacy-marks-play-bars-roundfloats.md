> **kind:** FINDING

# Night Hawk legacy-marks + play-bars roundFloats — FIXED

| Field | Value |
|-------|-------|
| **ID** | BO-P2-0107 |
| **Priority** | P2 |
| **Status** | FIXED |
| **Branch** | `fix/nighthawk-legacy-marks-play-bars-roundfloats` |

## What was broken

1. **`GET /api/market/nighthawk/legacy-marks`** returned raw `mark`/`bid`/`ask` from Polygon WS/REST without `roundFloats` at the JSON boundary. Legacy edition live marks could show IEEE float tails (e.g. `1.2345678901234`).

2. **`GET /api/market/nighthawk/play-bars`** returned minute-bar `c` closes without `roundFloats`. Play detail charts could render unrounded option premium paths.

## Fix

- Wrap legacy-marks success payload in `roundFloats({ available: true, marks })`.
- Wrap play-bars success payload in `roundFloats({ occ, since, points })`.

## Evidence

- Static route tests: `legacy-marks/route.test.ts`, `play-bars/route.test.ts` (boundary assertion + existing behavioral tests).
- Pattern scan during autopilot wake 2026-09-05.

## Blast radius

- Numeric display only on Night Hawk Legacy marks rail and play detail chart — no grading/logic change.
