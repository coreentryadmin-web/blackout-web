# Vector spy-volume route missing roundFloats — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Status** | FIXED in PR (fix/vector-spy-volume-roundfloats) |
| **Severity** | P3 |
| **Area** | Vector API boundary |

## Symptom

`/api/market/vector/spy-volume` returned raw IEEE floats in volume rows while every sibling Vector read route applies `roundFloats` at the boundary.

## Fix

Import `roundFloats` and wrap the `{ ymd, volumes, available }` payload. Extend `vector-roundfloats-routes.test.ts` source-scan guard to include `spy-volume/route.ts`.

## Verify

`npx tsx --test src/app/api/market/vector/vector-roundfloats-routes.test.ts` — 9/9 pass.
