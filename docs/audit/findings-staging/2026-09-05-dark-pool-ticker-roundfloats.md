# 2026-09-05 — dark-pool/ticker missing roundFloats at API boundary

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Severity** | P3 |
| **Area** | `/api/market/dark-pool/ticker` |
| **Status** | FIXED |

## Symptom

Per-ticker dark-pool snapshot returned raw IEEE floats at the JSON boundary while the sibling list route (`/api/market/dark-pool`) already wraps with `roundFloats` (#3756).

## Root cause

`ticker/route.ts` was added after the list-route rounding sweep and was never enrolled in a guard test.

## Fix

Import `roundFloats` and wrap `{ snapshot, symbol }` before `NextResponse.json`.

## Evidence

- `src/app/api/market/dark-pool/ticker/route.test.ts` — source-scan guard.
- Hourly pattern scan §3 (unrounded floats at API boundaries).

## RTH validation

Poll `/api/market/dark-pool/ticker?symbol=SPY` — premium/size/price fields should be 2dp with no long float tails.
