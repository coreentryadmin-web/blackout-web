> **kind:** FINDING

# Meridian API routes missing roundFloats at boundary — FIXED

| Field | Value |
|-------|-------|
| **ID** | BO-P2-meridian-roundfloats |
| **Priority** | P2 |
| **Area** | Meridian / API hygiene |
| **Status** | FIXED |

## Symptom

`GET /api/market/meridian/{event,timeline,lookup,peer-reactions}` returned live numeric fields (spot, expected move, reaction %, GEX reads, peer cohort stats) without `roundFloats` at the API boundary. Sibling market routes wrap at the boundary; raw division in Meridian loaders can emit long floats like `7499.360000000001`.

## Root cause

Routes assembled JSON inline and called `NextResponse.json(payload)` directly. Data-layer rounding in some loaders is partial; no final boundary pass on the wire shape.

## Fix

Wrap success payloads with `roundFloats(...)` before `NextResponse.json` on all four Meridian member routes. Source-scan test guards regression.

## RTH validation

Open Meridian earnings detail for a liquid name (e.g. NVDA); confirm reaction %, expected move, and positioning numbers show ≤2 decimal places on spot/walls and percentage fields.
