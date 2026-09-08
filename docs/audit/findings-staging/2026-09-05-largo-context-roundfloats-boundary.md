> **kind:** FINDING

# Largo contextual rail missing roundFloats at API boundary — FIXED

| Field | Value |
|-------|-------|
| **ID** | BO-P2-largo-context-roundfloats |
| **Priority** | P2 |
| **Area** | Largo / API hygiene |
| **Status** | FIXED in PR (pending merge) |

## Symptom

`GET /api/market/largo/context` returned live numeric fields (`spot`, walls, `net_premium`, `flow_top_print_share`, play `conviction`) without `roundFloats` at the API boundary. Sibling market routes wrap at the boundary; raw division in `validateFlowTape` can emit long floats.

## Root cause

Route assembled JSON inline and called `NextResponse.json({...})` directly. `fetchVectorFullState` rounds at the data layer, but `flow_top_print_share` comes from `topPrintPremium / grossPremium` without a final boundary pass.

## Fix

Wrap the success payload with `roundFloats(...)` before `NextResponse.json`. Source-scan test guards regression.

## RTH validation

Open Largo on any ticker with flow; confirm contextual rail numbers have ≤2 decimal places on spot/walls and flow share fields.
