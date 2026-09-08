# Spot SSE stream missing roundFloats at wire boundary — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **ID** | BO-P2-spot-stream-roundfloats |
| **Priority** | P2 |
| **Status** | FIXED (pending merge) |
| **Area** | `/api/market/stocks/spot-stream` |
| **PR** | fix/spot-stream-roundfloats |

## Symptom

Members on the generalized stock spot SSE lane (`/api/market/stocks/spot-stream`) could see raw IEEE-754 tails on `price` and `changePct` (e.g. `147.180000000001`) while the sibling REST quote route (`/api/market/quote`) already wraps responses in `roundFloats()`.

## Root cause

`encodeSpotFrame()` in `src/lib/ws/stocks-spot-stream-hub.ts` called `JSON.stringify(frame)` directly. The hub was added in the sub-second-spot project (PR 2/3) after the REST quote path had already adopted the repo-wide `roundFloats` boundary policy.

## Fix

Apply `roundFloats(frame)` inside `encodeSpotFrame()` before serialization. Regression test asserts `147.180000000001 → 147.18` and `1.23456789 → 1.23`.

## Blast radius

Only the SSE wire encoding — `buildSpotFrame()` still reads raw store values; rounding happens once at the member-facing boundary, matching `flows/stream` and `spx/pulse/stream`.
