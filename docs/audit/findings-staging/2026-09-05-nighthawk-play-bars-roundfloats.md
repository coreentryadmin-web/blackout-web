## 2026-09-05 — [P2, data-correctness] Night Hawk play-bars missing roundFloats at API boundary — FIXED

> **kind:** `FINDING`

| | |
|---|---|
| **Severity** | P2 — member-visible option mark chart could show IEEE float noise |
| **Found by** | Cursor pattern scan (hourly checklist) |
| **Status** | FIXED |

### Root cause

`/api/market/nighthawk/play-bars` returned raw Polygon minute-bar closes in `{ points: [{ t, c }] }` without `roundFloats` at the response boundary. Sibling Night Hawk routes (`edition`, `horizons`) already wrap responses.

### Fix

Import `roundFloats` and wrap `{ occ, since, points }` before `NextResponse.json`. Extended route test with source-scan guard and IEEE-noise fixture on the happy path.

### Evidence

`npx tsx --test src/app/api/market/nighthawk/play-bars/route.test.ts` — all pass.
