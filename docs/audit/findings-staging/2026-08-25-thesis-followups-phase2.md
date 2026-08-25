# Thesis-first follow-ups phase 2 — G1/G2/G5 + Helix/dark pool

> **kind:** FINDING

## Summary

Follow-up PR after #2903 (evidence bundle + G9). Ships partial board/thesis merge sync, rank calibration analyzer, Cortex veto dwell, and HELIX/dark-pool corroboration on thesis rails.

| Gap | Change |
|-----|--------|
| **G1** | `thesis-board-sync.ts` — after thesis merge, align setup `direction`, `discovery_origin`, and `origin_direction_conflict` from `MergedThesis` |
| **G2** | `rank-calibration.ts` — pure WR buckets + `ready_to_tune` only when n≥30 and +10pp vs baseline; does NOT auto-promote commit gates |
| **G5** | `cortex-veto-dwell.ts` — Redis latch; 3 consecutive non-veto passes to clear (`ZERODTE_CORTEX_VETO_DWELL_PASSES`, `0`=off) |
| **Helix** | `helix-tape-extras.ts` — batch Postgres tape aggregates merged into thesis extras in `scan.ts` |
| **Dark pool** | `crossProductCorroborationBoost` in `legacy-bridge.ts` when Vector dark-pool bias + HELIX tape align |

## Status

| **Status** | FIXED (pending deploy + session measurement) |

## Evidence

- `npx tsx --test` on thesis follow-up suite: **28/28 pass** (includes prior G9 tests)
- G2 commit-gate promotion still blocked until live ledger n≥30 on A/A+ buckets (`calibration:thesis-rank`)

## Blast radius

- Thesis-first live path only (`ZERODTE_THESIS_FIRST=1` or shadow)
- Cortex dwell applies to all fresh commits in `attachGateVerdicts` (default 3-pass dwell; disable with env `0`)
