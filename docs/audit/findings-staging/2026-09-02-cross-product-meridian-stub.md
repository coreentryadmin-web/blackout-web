# Meridian missing from cross-product ranking and multiproduct board

> **kind:** `FINDING`

| Field | Detail |
|---|---|
| **Status** | FIXED in `fix/cross-product-meridian-implementation` |
| **Severity** | P2 — cross-product features incomplete, Meridian always unavailable |
| **Surface** | `src/lib/largo/cross-product-ranking.ts` `scoreMeridian` + `src/lib/largo/live-multiproduct-board.ts` fetcher |

## Root cause

Phase 2d P1 implementation (commit 9cf3fcc39) shipped two new cross-product tools:
- `get_cross_product_ranking` — ranks setups across all 6 desks
- `get_live_multiproduct_board` — unified opportunity board across all desks

But the Meridian scorer was stubbed as a placeholder returning `null`, and the multiproduct-board fetcher was never added. This means:
- `rankSetupAcrossProducts` calls 6 parallel scorers but Meridian always fails → 5/6 products max
- `assembleMultiproductBoard` fetches only 5 products, not 6 → Meridian never included

A member asking "rank all desks by confidence" gets 5, not 6.

## Fix

**1. Meridian scorer** (`cross-product-ranking.ts`): Use `get_earnings_market` to find relevant earnings events and score by expected_move_pct. Confidence 0.7 (earnings data is reliable but historical, not live positioning).

**2. Meridian fetcher** (`live-multiproduct-board.ts`): Added `fetchMeridianSetups` that pulls earnings calendar events. Each event becomes a `UnifiedSetup` with:
- `setup_type: "Earnings event"`
- `direction` inferred from expected_move_pct sign
- `confidence: 0.6`
- `live: false` (calendar-based, not active trading)
- `freshness_minutes: 120` (earnings data ages slowly)

Both now use the same `get_earnings_market` tool, ensuring consistency across the cross-product surface. The fetch gracefully returns `[]` if earnings data is unavailable (no tool → no setups → Meridian simply absent from the board, not crashed).

## Evidence

- `npx tsc --noEmit` clean
- `npx tsx --test src/lib/largo/tool-defs.test.ts` 54/54 pass
- No new dependencies or API changes
- Board still limits to max 10 setups, with Meridian sharing the cap

## Blast radius

Only the two new cross-product tools. No changes to individual product tools, ranking/board logic, or transport caps. Earnings data (`get_earnings_market`) was already in use by Helix scorer and other tools — this just adds one more consumer.
