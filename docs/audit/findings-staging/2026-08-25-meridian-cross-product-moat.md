# Meridian cross-product moat — Vector + Night Hawk + SPX inline previews

> **kind:** `FINDING`

| **Status** | FIXED in `cursor/meridian-cross-product-moat-3d11` |
| **Audit** | `docs/audit/MERIDIAN-CTO-AUDIT-2026-08-25.md` §5 idea 3, §8 |
| **Surface** | Meridian earnings → Positioning + Summary tabs |

## Problem

Thermal and HELIX already render live inline cards on Positioning. Vector, Night Hawk, and SPX
were plain "Jump to desk" links even though live snapshots existed server-side.

Summary CALL/PUT cards showed wall-implied underlying probabilities without strike/expiry framing,
making it harder to connect structure to a concrete contract idea without crossing into fabricated
"chance of profit."

## Fix

**Positioning (cross-product moat)**

- Vector: cache-first `fetchVectorFullState` + `meridian-vector-for-earnings-core.ts` (prior commit).
- Night Hawk: cache-read today's board snapshot; `shapeMeridianNighthawkBoardRead` surfaces ledger
  or setup row when the earnings ticker is on board.
- SPX: for SPX/SPXW events only, `getSpxDeskSummary` + SPX Slayer play badge → inline desk card.

**Summary (honest options-play framing, §8)**

- `buildPlayContractLabel` wraps the existing wall strike + `thermal.expiry_used` in
  `TICKER STRIKEC · MM/DD` form.
- Probability copy explicitly labels **underlying close past level**, not contract P&amp;L.
- Per-card disclaimer: structure framing only — not a trade recommendation.

## Evidence

- `meridian-vector-for-earnings-core.test.ts`
- `meridian-cross-product-for-earnings-core.test.ts`
- `meridian-summary-core.test.ts` (contract label + absent-expiry honesty)
- Cards hidden when `available: false` — no fabricated numbers
