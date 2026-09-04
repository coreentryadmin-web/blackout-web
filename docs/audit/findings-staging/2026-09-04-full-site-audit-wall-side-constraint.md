# 2026-09-04 — full-site-audit-wall-side-constraint

> **kind:** FINDING

## RTH deep audit false-P0 on heatmap walls (unconstrained deriveWalls)

| Field | Detail |
|-------|--------|
| **Severity** | P1 (audit harness — not member-visible data) |
| **Surface** | `scripts/full-site-deep-audit.mjs` / GitHub Actions `RTH deep audit` |
| **Status** | FIXED |

### Symptom

`full-site-deep-audit.mjs` derived expected `call_wall`/`put_wall` via an unconstrained global argmax/argmin over `strike_totals`. Production (and `heatmap-matrix-audit.mjs`, `gex-wall-invariants.mjs`) has been **side-constrained since #2417/#2521**: call wall above spot, put wall below spot.

Live RTH run on `main` @ `1b65d627` reported six P0 heatmap mismatches (e.g. `SPX.put_wall: reported 7700 != 8000`) while the served walls matched the constrained definition — the audit expected the old unconstrained extreme.

### Fix

Import shared `wallsFromStrikeTotals(strike_totals, hm.spot)` from `scripts/audit/lib/gex-wall-invariants.mjs` (byte-equivalent to production) and remove the local unconstrained helper.

### Evidence

- `node --import tsx scripts/audit/lib/gex-wall-invariants.test.mjs` — existing SPX/SPY constrained-wall cases cover the disagreement class
- Re-run `node scripts/full-site-deep-audit.mjs` during RTH: heatmap wall P0s cleared (socket-health/postgres may still fail independently)

### Market-open validation

- GitHub Actions `RTH deep audit` job: heatmap section should not emit `reported X != Y` wall P0s when prod walls are side-constrained correctly
