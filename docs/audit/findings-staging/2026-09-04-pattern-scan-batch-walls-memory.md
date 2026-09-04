# Pattern-scan fixes: batch roundFloats, positioning fallback walls, Largo memory freshness

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Priority** | P1/P2 |
| **Area** | API boundaries, GEX positioning, Largo |
| **PR** | (this branch) |

## Symptoms

Hourly pattern scan (2026-09-04 off-hours) surfaced three concrete defects:

1. **`/api/market/gex-heatmap/batch`** returned unrounded IEEE tails on the Thermal compare grid while the single-ticker route already applied `roundFloats`.
2. **`/api/market/gex-positioning` polygon-fallback path** picked `call_wall`/`put_wall` via unconstrained global max-positive/max-negative scan — same wrong-side geometry class fixed in #2417 for other producers.
3. **`isMemoryFresh()`** in Largo conversation memory treated clock-skewed future `lastUpdated` as perpetually fresh (negative age always `< maxAgeSeconds`).

## Fix

- Wrap batch response in `roundFloats({ tickers: tickersOut })`.
- Build `strikeTotals` from fallback `ranked_levels` and delegate to `wallsFromStrikeTotals(strikeTotals, spot)`.
- Reject future-skewed `lastUpdated` in `isMemoryFresh` (`ageSeconds < 0 → false`).

## Evidence

- `npx tsx --test` on `conversation-memory.test.ts`, `gex-heatmap/batch/route.test.ts`, `wall-side-constraint.test.ts` — 39/39 pass.

## RTH validation

- Thermal compare grid (`/heatmap` multi-ticker preset): no `7499.360000000001`-class floats in network tab.
- `GET /api/market/gex-positioning?ticker=MSFT` during a deliberate cache miss: `call_wall` must sit above spot when `degraded:true`.
- Largo follow-up reuse: skewed-future memory must not bypass freshness gate.
