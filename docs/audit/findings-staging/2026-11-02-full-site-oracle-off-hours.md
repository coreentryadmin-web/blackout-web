# 2026-11-02 RTH deep audit false P0 — SPX oracle off-hours

> **kind:** FINDING

| Field | Value |
| --- | --- |
| **Status** | FIXED |
| **Severity** | P2 CI |

## What broke

`audit` / RTH deep audit on `8f9e0d4d` (Mon 17:30 ET, off-hours): P0 `[oracle] SPX: desk 7552.74 vs Polygon 7541.40 (Δ 11.34)` — desk last mark vs official cash close, not a live divergence bug.

## Fix

Gate SPX Polygon oracle in `full-site-deep-audit.mjs` on `inRthOpenWindow()`; skip with documented ok off-hours.

## Verify

`npx tsx --test scripts/full-site-deep-audit.test.mjs`
