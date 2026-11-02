## 2026-11-02 — [FINDING, P1 audit-harness] RTH deep audit false P0: SPX oracle used fixed 5pt band off-hours — FIXED

> **kind:** `FINDING`

| | |
|---|---|
| **Status** | FIXED (PR pending) |
| **Found by** | RTH deep audit on `main` @ `8f9e0d4db`, run `41537722853` |
| **Scope** | `scripts/full-site-deep-audit.mjs` |

### Root cause

Off-hours (Mon 17:30 ET), full-site audit compared platform snapshot SPX to Polygon `I:SPX`
with a hard **Δ > 5 points** fail. Desk 7552.74 vs Polygon 7541.40 (Δ 11.34, **0.15%**) tripped P0
while `data-validator.mjs` already allows **1.5%** off-hours for the same comparison class.

### Fix

Use RTH-aware percent tolerance (0.3% RTH / 1.5% off-hours) via `inRthOpenWindow()`, matching
`data-validator.mjs`.

### Regression guard

`scripts/full-site-deep-audit.test.mjs` — source guard against reintroducing `d > 5`.
