# 2026-09-04 — Vector contract-picks/live + play-bie roundFloats

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Severity** | P2 |
| **Area** | Vector API routes |
| **Status** | FIXED |

## Symptom

`POST /api/market/vector/contract-picks/live` and `POST /api/market/vector/play-bie` returned raw IEEE floats (bid/ask/mid/greeks, `favPct`) while every other Vector member read already calls `roundFloats` at the JSON boundary.

## Root cause

These two routes were added after the #3745 sweep that fixed universe/wall-history/daily-regime/rail-bootstrap/contract-picks and were never enrolled in `vector-roundfloats-routes.test.ts`.

## Fix

- Wrap both success responses in `roundFloats(...)`.
- Add `favPct: 4` to `VECTOR_FRACTION_DP` (fraction 0–1; 2dp quantizes small rates to zero).

## Evidence

- `vector-roundfloats-routes.test.ts` extended to cover both routes.
- Pattern scan from hourly checklist §3.

## RTH validation

- Open Vector, trigger live pick monitor — bid/ask/mid should be 2dp with no float tails.
- Play card BIE line: `favPct` should render sensibly (not 0.00% on a 0.4% historical rate).
