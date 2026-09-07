# Largo matrix_age_sec future-skew age-0 trap — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **ID** | BO-P2-largo-matrix-age-skew |
| **Status** | FIXED (PR pending) |
| **Severity** | P2 — Largo C2 freshness contract |
| **Area** | Largo product reads |

## Symptom

`ageSecondsFrom` in `product-reads.ts` and a duplicate `ageSecondsFromIso` in `helix-thermal-compare.ts` used `Math.max(0, now - t)`, so a clock-skewed **future** matrix `asof` reported **0s old** instead of unusable. Same class as #4471 (options cluster marks) and `gex-heatmap-for-largo.ts` (already fixed via `et-session-facts.ageSecondsFromIso`).

`helix-tape-analytics.ts` `newest_age_minutes` had the identical trap for the freshest print timestamp.

## Fix

- Delegate `product-reads.ageSecondsFrom` → shared `ageSecFromIso` (`WS_TIMESTAMP_FUTURE_TOLERANCE_MS` fail-closed).
- Remove duplicate helper in `helix-thermal-compare.ts`; use same shared helper for `age_seconds`.
- Guard `tapeWindowCoverage.newest_age_minutes` with the same tolerance.

## Evidence

Regression tests in `product-reads.test.ts`, `helix-thermal-compare.test.ts`, `helix-tape-analytics.test.ts`.
