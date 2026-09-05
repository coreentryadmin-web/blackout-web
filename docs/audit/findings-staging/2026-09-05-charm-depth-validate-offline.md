> **kind:** FINDING

## No CHARM depth validator sibling to `gex-depth-validate.mjs` — FIXED (offline phase)

| Field | Value |
|-------|-------|
| **Status** | FIXED (offline closed-form audit; live chain cross-check deferred) |
| **Severity** | P2 observability |
| **CLQ** | CLQ-017 |

## Root cause

`polygon-options-gex.ts` computes dollar-CHARM via closed-form `charmPerShare()` but had no audit script mirroring `scripts/audit/gex-depth-validate.mjs`.

## Fix

Added `scripts/audit/charm-depth-validate.mjs` — offline grid validating `charmPerShare()` against independent Black-Scholes call-delta finite-difference (−∂Δ/∂T convention). Regression: `scripts/audit/charm-depth-validate.test.mjs` (2/2).

## Deferred

Live Polygon chain cross-check (provider `charm.total` vs recomputed sum) — follow-up when RTH validation bandwidth allows; mirrors gex-depth live mode.
