# Full-site deep audit false P0 on heatmap walls — FIXED

> **kind:** FINDING

| Field | Value |
| --- | --- |
| **Status** | FIXED |
| **Severity** | P0 (audit CI gate) |
| **Surface** | `scripts/full-site-deep-audit.mjs` → RTH deep audit workflow |
| **Detected** | 2026-09-04 RTH deep audit run `33903727473` |

## Symptom

Scheduled `gha-rth-audit.mjs` failed with six P0 heatmap wall mismatches, e.g. `SPX.put_wall: reported 7700 != 8000`.

## Root cause

`full-site-deep-audit.mjs` re-derived walls with an unconstrained local `deriveWalls(strike_totals)`. Production has been side-constrained since #2417: call wall above spot, put wall below spot.

## Fix

Import shared `wallsFromStrikeTotals` from `scripts/audit/lib/gex-wall-invariants.mjs` and pass `hm.spot` when checking GEX call/put walls.

## Evidence

`scripts/full-site-deep-audit.test.mjs` — source guard. `gex-wall-invariants.test.mjs` covers the shared helper.
