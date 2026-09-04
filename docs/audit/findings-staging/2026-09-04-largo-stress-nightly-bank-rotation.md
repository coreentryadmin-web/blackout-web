# Largo nightly stress — bank rotation to fit 45-minute budget

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Priority** | P2 |
| **Area** | CI / Largo |
| **Status** | FIXED |

## Symptom

`largo-stress-nightly.yml` ran `LARGO_STRESS_BANK=all` (523 live probes) at `concurrency=1` inside a `timeout-minutes: 45` job. Measured 2026-08-31: **15/19** scheduled runs ended `cancelled` at the timeout wall — the dominant outcome, not a flake. Ops issues (#3579, #3399, …) opened correctly after the `failure() || cancelled()` alerting fix but the underlying run still never completed.

## Root cause

Structural scope mismatch: even at an optimistic 30s/probe average, 523 sequential probes need ~4.4 hours. The 45-minute budget was never sufficient for `all` banks nightly.

## Fix

- Added `scripts/largo-stress-nightly-bank.mjs` — rotates banks **1→4** by UTC day-of-year so full coverage cycles every four nights.
- Nightly workflow runs **one bank** at `LARGO_STRESS_CONCURRENCY=5` (largest bank ≈193 probes → ~39 batches).
- `workflow_dispatch` retains `bank=all` with `timeout-minutes: 360` for manual full sweeps.

## Evidence

- `npx tsx --test src/largo-stress-nightly-bank-rotation.test.ts` — rotation + workflow ratchet GREEN.
- Bank sizes: bank1=109, bank2=100, bank3=193, bank4=121 (merged=523).

## Blast radius

CI workflow only — no member-visible surface.
