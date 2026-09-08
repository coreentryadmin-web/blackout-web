> **kind:** FINDING

# Largo technicals live change_pct + Night Hawk record roundFloats — FIXED

| Field | Value |
|-------|-------|
| **ID** | BO-P2-3834 / BO-P2-3835 / BO-P2-3836 |
| **Priority** | P2 |
| **Status** | FIXED |
| **Branch** | `fix/largo-technicals-change-pct-nighthawk-record-roundfloats` |

## What was broken

1. **`buildLargoTechnicals` stock WS path** returned live spot from `getStockLiveCandle()` but dropped `changePct`, leaving day % null during RTH even when the store had an authoritative REST-anchored anchor.

2. **`buildLargoTechnicals` index path** used REST-only `fetchIndexSnapshots` (or A.* stock candles) instead of the live `indexStore` overlay used by `/api/market/quote` — SPX/VIX could lag the desk during RTH.

3. **`GET /api/market/nighthawk/record`** omitted the standard `roundFloats` API boundary wrap that sibling Night Hawk routes already use.

## Fix

- Stock WS: set `changePct = wsCandle.changePct` when live price is used.
- Index: `resolveLiveIndexWsEntry` + `overlayRestIndexWithWs` over the REST snapshot baseline.
- Record route: wrap success payload in `roundFloats(...)`.

## Evidence

- `src/lib/largo/technicals.test.ts` — source scan for WS change_pct + index overlay imports.
- `src/app/api/market/nighthawk/record/route.test.ts` — boundary roundFloats scan.

## RTH validation

- Largo `get_technicals` for NVDA during RTH: spot + non-null `change_pct` when REST seed landed.
- Largo `get_technicals` for SPX: spot tracks desk header; `change_pct` matches quote overlay not stale REST-only.
