# Full-site deep audit false P0 on heatmap walls — FIXED

> **kind:** FINDING

| Field | Value |
| --- | --- |
| **Status** | FIXED |
| **Severity** | P0 (audit CI gate) |
| **Surface** | `scripts/full-site-deep-audit.mjs` → RTH deep audit workflow |
| **Detected** | 2026-09-04 RTH deep audit run `33903727473` |

## Symptom

Scheduled `gha-rth-audit.mjs` failed with six P0 heatmap wall mismatches, e.g.:

- `SPX.put_wall: reported 7700 != 8000`
- Similar failures on SPY, NVDA, AAPL, META

Production Thermal matrix and `heatmap-matrix-audit.mjs` were healthy — only `full-site-deep-audit.mjs` disagreed.

## Root cause

`full-site-deep-audit.mjs` re-derived walls with an **unconstrained** local `deriveWalls(strike_totals)` (global argmax/argmin). Production has been **side-constrained** since #2417/#2521: call wall above spot, put wall below spot. `heatmap-matrix-audit.mjs`, `heatmap-verifier.ts` INV-3, and `scripts/audit/lib/gex-wall-invariants.mjs` were updated; this script was missed.

When the most-negative gamma strike sits above spot (common for SPX), unconstrained derivation picks that strike as put wall while API correctly serves the constrained put wall below spot → confident false P0.

## Fix

- Import shared `wallsFromStrikeTotals` from `scripts/audit/lib/gex-wall-invariants.mjs`
- Pass `hm.spot` when checking GEX call/put walls
- Source regression test: `scripts/full-site-deep-audit.test.mjs`

## Evidence

- SPX fixture in `gex-wall-invariants.test.mjs`: unconstrained put wall 8000 vs constrained 7500 at spot 7788.84
- CI failure pattern matches unconstrained vs constrained divergence, not WS/Polygon inconsistency
