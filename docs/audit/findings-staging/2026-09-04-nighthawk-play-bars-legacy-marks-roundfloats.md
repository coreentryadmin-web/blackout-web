# Night Hawk play-bars + legacy-marks missing roundFloats at API boundary — FIXED

> **kind:** `FINDING`

| Field | Value |
|---|---|
| **Status** | FIXED |
| **Found by** | Cursor autopilot hourly pattern scan, 2026-09-04 |
| **Priority** | P2 Correctness / UX |

## What was broken

`GET /api/market/nighthawk/play-bars` and `GET /api/market/nighthawk/legacy-marks` returned
raw Polygon/provider IEEE floats at the JSON boundary (`points[].c`, `marks[].mark/bid/ask`).
Sibling Night Hawk routes (`horizons`, `edition`, zerodte `marks` via `live-marks.ts`) already
apply `roundFloats` — these two did not.

## Evidence

Hourly checklist pattern scan (`Unrounded floats at API boundaries`) flagged routes under
`src/app/api/market/nighthawk/` without `roundFloats`. `play-bars` maps Polygon minute-bar
closes straight through; `legacy-marks` assembles WS/REST quote fields via `buildLegacyOptionMarkRow`
with no rounding step before `NextResponse.json`.

## Fix

Wrap both success payloads in `roundFloats(...)` at the route edge, matching every other
member-visible market route.

## Tests

- `src/app/api/market/nighthawk/play-bars/route.test.ts` — source-text guard
- `src/app/api/market/nighthawk/legacy-marks/route.test.ts` — source-text guard

## RTH validation

Off-hours: no live chart marks to eyeball. At RTH open, open a Legacy play detail rail and
confirm mark/bid/ask show at most 2dp (no `24.750000000001` noise) and the play mark history
chart tooltip prices are clean.
