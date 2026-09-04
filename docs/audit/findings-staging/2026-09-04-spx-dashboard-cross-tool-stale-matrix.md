# 2026-09-04 — SPX dashboard E2E false flip divergence (stale matrix snapshot)

> **kind:** FINDING

## Symptom

`spx-dashboard-e2e-audit.mjs` reported `integration:spx-cross-tool` FAIL during RTH:
`flip matrix 6990.72 vs positioning 7795.45` (~805pt gap on SPX ~7736).

## Root cause

`crossToolIntegration()` compared flip from the matrix fetched at the start of the audit (after
full cell validation, often 30–60s earlier) against a fresh `/api/market/gex-positioning` read.
SPX matrix cache turns over every ~8s RTH; when the book's zero-gamma crossing moved between
generations, the harness flagged a product defect. Live back-to-back probe with matching
`calculation_id` showed `delta: 0` — same snapshot, identical flip.

## Fix

Re-fetch `/api/market/gex-heatmap?ticker=SPX` inside `crossToolIntegration` in the same pass as
positioning (mirrors `spx-rth-all-day-audit` `Promise.all` cross-endpoint). Annotate flip FAILs
with `calculation_id` match/mismatch for faster triage.

## Status

FIXED — regression test `scripts/audit/lib/cross-tool-tolerance.test.mjs`.
