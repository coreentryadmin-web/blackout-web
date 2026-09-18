# 2026-09-18 — SPX desk GEX sticky fallback discarded numeric values

> **kind:** `FINDING`

| Field | Value |
|-------|-------|
| **Severity** | P2 |
| **Area** | `spx-desk.ts` GEX fallback |
| **Status** | FIXED |

## Symptom

When a live GEX heatmap fetch failed or timed out, `stickyDeskGexFallback()` returned `null` for `gex_net`, `gex_king`, and `max_pain` despite setting `gex_stale: true` and preserving walls/flip. The API contract (line 1039 comment) states that `gex_stale: true` means "walls are REAL but not live" — implied sticky numeric values — but the implementation contradicted the documentation by discarding them.

Health-check on 2026-09-18 found `/api/market/spx/desk` returning `gex_king: null` while `/api/market/spx/play` (same cache key path) cited live values in the same moment, indicating one fetch succeeded while the other's fallback discarded its last-good state.

## Root cause

`stickyDeskGexFallback()` (lines 243-268) returned `gex_net: null, gex_king: null, max_pain: null` when the upstream fetch failed, instead of preserving the values from the prior successful fetch. The function already preserved `lastGoodGammaFlip`, `lastGoodGexWalls`, and `lastGoodStrikeLevels` — the missing preservation was the three numeric GEX fields only.

## Fix

- Added three sticky variables at module scope (lines 155-157): `lastGoodGexNet`, `lastGoodGexKing`, `lastGoodMaxPain`
- Capture these values in `resolveCanonicalDeskGex()` (lines 439-441) when a successful fetch occurs, following the same pattern as `lastGoodGammaFlip` and `lastGoodGexWalls`
- Modified `stickyDeskGexFallback()` to return these sticky values instead of `null` (lines 257-259)

## Evidence

- `spx-desk-offhours-spot.test.ts` — source-code assertions verifying:
  1. Sticky variables are declared
  2. `stickyDeskGexFallback()` returns the sticky values, not null
  3. `resolveCanonicalDeskGex()` captures the values on successful fetch

## Contract validation

The fix aligns the implementation with the documented contract: when `gex_stale: true`, the returned `gex_net`/`gex_king`/`max_pain` are now "sticky last-good, not live" (preserved from prior successful fetch), consistent with how walls are already preserved.

## RTH validation

- `/api/market/spx/desk` and `/api/market/spx/play` now agree on GEX numeric values when the matrix fetch times out mid-session
- GEX values persist as sticky across brief upstream outages, with the age badge signaling staleness to the UI
