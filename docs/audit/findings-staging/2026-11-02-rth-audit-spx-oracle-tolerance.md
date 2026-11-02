# RTH deep audit — SPX oracle flat $5 false P0 post-close

> **kind:** FINDING

| **Status** | FIXED (PR pending) |
|------------|-------------------|

## What broke

Run `41537722853` on `main@8f9e0d4` (Mon 17:30 ET): P0 `[oracle] SPX: desk 7552.74 vs Polygon 7541.40 (Δ 11.34)` — ~0.15% gap, within `data-validator` off-hours `priceTol` (1.5%) but over the audit's hard `$5` absolute gate.

## Fix

Align `full-site-deep-audit.mjs` oracle check with `data-validator.mjs`: 0.3% RTH / 1.5% off-hours via `inRthOpenWindow()`.
