# API boundary roundFloats gaps — member-visible float noise

> **kind:** FINDING

## Summary

| **Status** | FIXED |
|------------|-------|
| **Severity** | P1 |
| **Area** | API responses / data correctness |
| **PR** | (pending) |

## What was broken

Several high-traffic member routes returned computed numeric payloads via `NextResponse.json` without `roundFloats()` at the API boundary. Sibling routes in the same product areas (e.g. `nighthawk/edition`, `flows/stream`, `spx/pulse/stream`) already round — these did not, so IEEE tails like `7499.360000000001` could reach the UI.

Affected routes:

- `POST /api/market/nighthawk/hunt`
- `GET /api/market/nighthawk/legacy-marks`
- `GET /api/market/nighthawk/play-bars`
- `GET /api/market/largo/context`
- `GET /api/market/dark-pool` + `/ticker`
- `GET /api/market/stocks/spot-stream` (SSE hub `buildSpotFrame`)

## Fix

Wrap success payloads with `roundFloats()` at each route boundary (SSE hub rounds in `buildSpotFrame` before encode). Regression guard: `src/app/api/market/api-roundfloats-boundaries.test.ts`.

## Validation

- `npx tsx --test src/app/api/market/api-roundfloats-boundaries.test.ts`
- `npx tsx --test src/lib/ws/stocks-spot-stream-hub.test.ts`
