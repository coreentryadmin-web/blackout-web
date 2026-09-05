## 2026-09-05 — [P2, data-correctness] Night Hawk hunt missing roundFloats at API boundary — FIXED

> **kind:** `FINDING`

| | |
|---|---|
| **Severity** | P2 — member-visible hunt scores / SPX context could show IEEE float noise |
| **Found by** | Cursor pattern scan (post-#3812 work loop) |
| **Status** | FIXED |

### Root cause

`POST /api/market/nighthawk/hunt` returned `platform_context.spx_price` and play `score` fields from floating-point scan math without `roundFloats` at the response boundary. Sibling Night Hawk routes (`edition`, `horizons`, `play-bars`, `legacy-marks`) already wrap responses (#3812/#3814).

### Fix

Import `roundFloats` and wrap the assembled `HuntResponse` before `NextResponse.json`. Added source-scan regression test mirroring play-bars route guard.

### Evidence

`npx tsx --test src/app/api/market/nighthawk/hunt/route.test.ts` — pass.
