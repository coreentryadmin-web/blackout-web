# 2026-09-04 — API roundFloats boundary gaps (batch 2)

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Severity** | P2 |
| **Area** | dark-pool/ticker, anomalies, nighthawk play-bars/legacy-marks, stocks spot SSE |
| **Status** | FIXED |

## Symptom

Five member-facing API/SSE paths returned raw IEEE floats at the JSON boundary while sibling routes already call `roundFloats` (e.g. `7499.360000000001`-class noise on premiums, marks, and spot quotes).

## Root cause

Routes added or split after the Vector roundFloats sweep (#3756, #3785) were never enrolled in the boundary-rounding pattern.

## Fix

- `dark-pool/ticker/route.ts` — `roundFloats({ snapshot, symbol })`
- `anomalies/route.ts` — `roundFloats({ anomalies })`
- `nighthawk/play-bars/route.ts` — `roundFloats({ occ, since, points })`
- `nighthawk/legacy-marks/route.ts` — `roundFloats({ available, marks })`
- `stocks-spot-stream-hub.ts` — `roundFloats` inside `buildSpotFrame`

## Evidence

- Source-scan + behavioral tests in each route's `route.test.ts` and `stocks-spot-stream-hub.test.ts`.
- Hourly pattern scan §3 (2026-09-04).

## RTH validation

- Poll `/api/market/dark-pool/ticker?symbol=SPY` — premium/size fields clean 2dp.
- Open a Legacy Night Hawk row — legacy-marks `mark`/`bid`/`ask` no long float tails.
- Stocks spot SSE on any desk with live tickers — `price`/`changePct` rounded in stream frames.
