# API roundFloats + SPX brief pin labels + Vector AUTO RTH range — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Priority** | P2 |
| **Area** | API boundaries, BIE prose, Vector AUTO layout |

## What was broken

1. **Unrounded floats** — `GET /api/market/dark-pool`, `GET /api/market/dark-pool/ticker`, and `GET /api/market/anomalies` returned raw Postgres/UW floats (e.g. `7499.360000000001`) at the API boundary.
2. **Pin vs GEX king label confusion** — `spx-desk-brief.ts` rendered `desk.gex_king ?? desk.max_pain` as `pin … (price magnet)`, conflating GEX positioning with the EOD pin forecaster product.
3. **Vector AUTO extended-hours range** — `candleRangeFromBars` min/maxed premarket/after-hours bars, inflating AUTO node density vs RTH HOD/LOD display.

## Fix

- Wrap dark-pool + anomalies JSON in `roundFloats`.
- Label `gex_king` as "GEX king" and `max_pain` as "max pain" in LEVELS/WHY prose.
- Filter bars through `filterRthBarsSec` when every bar carries a `time` field.

## Evidence

- `npx tsx --test src/app/api/market/dark-pool/route-roundfloats.test.ts`
- `npx tsx --test src/lib/bie/spx-desk-brief.test.ts`
- `npx tsx --test src/features/vector/lib/vector-adaptive-nodes.test.ts`

## RTH validation

- SPX desk brief on `/dashboard` during RTH: LEVELS line should read "GEX king" not "pin (price magnet)" when king node is near spot.
- Vector AUTO on NVDA: bead row count should track RTH session range, not premarket wicks.
