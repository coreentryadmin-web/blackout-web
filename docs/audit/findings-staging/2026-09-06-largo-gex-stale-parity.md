# Largo swing brief — stale GEX posture parity across sections — FIXED

> **kind:** `FINDING`

| Field | Value |
|-------|-------|
| **ID** | BO-P1-largo-gex-stale-parity |
| **Pri** | P1 |
| **Area** | Night Hawk Swings / Ask Largo |
| **Status** | FIXED in PR (pending merge) |

## Symptom

#4355 gated stale GEX matrix reads in `dealerPostureLine` (Trade manager narrative) but `gexPostureSection` (expand-intel detail) and `counterThesisLine` still treated stale `gamma_posture` as live — Largo C2 violation on the same read.

## Fix

- `gexPostureSection`: prefix **Last snapshot (~Xs old)** when `gexMatrixStale`.
- `counterThesisLine`: skip GEX-sourced posture steelman when matrix is stale (mirrors stale HELIX guard).

## Evidence

`npx tsx --test` on `play-brief-intel.test.ts` + `play-brief-narrative.test.ts` — new stale-parity cases pass.
