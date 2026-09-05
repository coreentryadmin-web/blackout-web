> **kind:** FINDING

# Meridian + gex-heatmap batch + SPX commentary missing roundFloats — FIXED

| Field | Value |
|-------|-------|
| **ID** | BO-P2-market-roundfloats-boundary-gap |
| **Priority** | P2 |
| **Area** | API hygiene / member-visible numbers |
| **Status** | FIXED in PR (pending merge) |

## Symptom

Six market routes returned live numeric payloads without `roundFloats` at the API boundary while sibling routes (single-ticker `gex-heatmap`, SPX pulse/desk/merged, platform intel) already wrap. Members could see raw IEEE tails like `7499.360000000001` on Thermal compare grid, Meridian earnings panels, and SPX commentary cards.

## Root cause

Boundary rounding was applied incrementally route-by-route; batch Meridian and commentary paths were missed in prior sweeps.

## Fix

Wrap success `NextResponse.json` payloads with `roundFloats(...)` in:
- `gex-heatmap/batch/route.ts`
- `spx/commentary/route.ts`
- `meridian/event`, `timeline`, `lookup`, `peer-reactions` routes

Source-scan regression test: `market-roundfloats-routes.test.ts`.

## RTH validation

- Thermal compare grid: spot/wall numbers ≤2 decimals on multi-ticker batch load.
- Meridian earnings event detail: reaction % and range fields cleanly rounded.
- SPX commentary rail: desk levels in commentary card show no float tails.
