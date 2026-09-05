# API boundary roundFloats — gex-heatmap batch + anomalies

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Priority** | P2 |
| **Area** | API / data correctness |
| **PR** | (pending) |

## Symptom

Two market API routes returned raw IEEE floats at the JSON boundary:

- `GET /api/market/gex-heatmap/batch` — Thermal compare grid (up to 11 tickers) served unrounded `spot`, strike totals, flip, etc.
- `GET /api/market/anomalies` — HELIX anomaly tape served unrounded `premium` from Postgres.

Sibling routes (`/api/market/gex-heatmap`, `/api/market/flows`, `/api/market/nighthawk/hunt`) already wrap with `roundFloats`.

## Root cause

Batch route was added as a cache-reader parallel read without mirroring the single-ticker route's boundary rounding. Anomalies route predates the roundFloats sweep and was never updated.

## Fix

Wrap both `NextResponse.json` payloads with `roundFloats(...)`. Source-scan regression tests mirror `nighthawk/hunt/route.test.ts`.

## Market-open validation

Off-hours: hit both routes as admin+premium and confirm numeric fields have ≤6 decimal places (no `7499.360000000001` noise). Thermal compare grid should match single-ticker matrix values after rounding.
