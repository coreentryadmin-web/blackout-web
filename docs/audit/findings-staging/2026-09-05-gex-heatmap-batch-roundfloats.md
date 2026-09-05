# 2026-09-05 — GEX heatmap batch route missing roundFloats

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Severity** | P2 |
| **Area** | `/api/market/gex-heatmap/batch` (Thermal compare grid) |
| **Status** | FIXED |

## Symptom

Batch compare-grid responses could leak IEEE float tails (`7499.360000000001`) while the single-ticker sibling route wraps with `roundFloats`.

## Fix

Wrap `NextResponse.json` payload with `roundFloats({ tickers: tickersOut })`.

## Evidence

- `batch/route.test.ts` source-scan guard.
