# Spot-stream SSE wire boundary missing roundFloats

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **ID** | spot-stream-round-floats |
| **Severity** | P2 |
| **Area** | `/api/market/stocks/spot-stream` |
| **Status** | FIXED |

## Symptom

Member-visible stock spot SSE frames (`encodeSpotFrame` in `stocks-spot-stream-hub.ts`) serialized raw `price` and `changePct` from `stock-candle-store` without `roundFloats`, unlike the sibling REST path `GET /api/market/quote` which rounds at the boundary. Float noise (e.g. `147.129999999999`, `5.092857142857143`) could reach clients on the push stream.

## Root cause

`encodeSpotFrame` called `JSON.stringify(frame)` directly. The hourly pattern scan (unrounded floats at API boundaries) caught this gap after sibling fixes landed for SPX pulse stream (#3753), HELIX flows stream (#3754), and Vector routes (#3756).

## Fix

Apply `roundFloats(frame)` inside `encodeSpotFrame` before `JSON.stringify`. Regression test asserts noisy inputs round to 2dp at the wire.

## Evidence

```
npx tsx --test src/lib/ws/stocks-spot-stream-hub.test.ts
# 12 pass, 0 fail — includes "encodeSpotFrame: rounds member-visible floats at the SSE wire boundary"
```
