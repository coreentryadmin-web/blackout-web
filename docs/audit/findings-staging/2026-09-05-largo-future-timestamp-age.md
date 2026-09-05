> **kind:** FINDING

# 2026-09-05 — Largo compare + history list: future timestamp age reads false-fresh

| Field | Value |
|-------|-------|
| **ID** | BO-P1-0106 |
| **Pri** | P2 |
| **Area** | Largo Thermal compare (`product-reads.ts`, `helix-thermal-compare.ts`) + Largo history toolbar |
| **Status** | FIXED |

## Symptom

Three duplicate `ageSecondsFrom*` helpers used `Math.max(0, now - t)` so a clock-skewed **future** `asof` reported **0 seconds old** instead of unusable. Largo `formatRelative` showed **"just now"** for future history timestamps.

## Root cause

`et-session-facts.ts` and `timestamp-freshness.ts` already return `null` for negative age; these copies never adopted the guard.

## Fix

- `ageSecondsFrom` (`product-reads.ts`): `age < 0 ? null : age`
- `ageSecondsFromIso` (`helix-thermal-compare.ts`): same
- `formatRelative` (`LargoTerminalToolbar.tsx`): future beyond 5s tolerance → `"clock skew"`

## Regression tests

- `product-reads.test.ts`: future asof → null
- `helix-thermal-compare.test.ts`: future matrix asof → null `age_seconds`
- `LargoTerminalToolbar-format-relative.test.ts`: future ts → clock skew

## RTH validation

- Open Largo, run a Thermal compare query — confirm `matrix_age_sec` is null (not 0) if upstream asof is clock-skewed future during a deploy boundary.
