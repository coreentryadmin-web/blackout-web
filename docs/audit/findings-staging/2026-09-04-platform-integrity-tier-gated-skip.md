# Platform integrity false WARN on tier-gated GEX routes — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Priority** | P2 |
| **Area** | audit harness |
| **PR** | (pending) |

## Symptom

`npm run validate:platform-integrity` during RTH lifecycle reported 4 WARN rows (`gex-positioning-spx`, `thermal-matrix-SPY`, `thermal-matrix-QQQ`, `vector-spx-0dte-walls`) with `strikes=0 spot=—` even though prod was healthy.

## Root cause

PR #3603 registered `/meridian` and aligned desk routes behind tier gates. `gex-heatmap`, `gex-positioning`, and `vector/walls` now return **401 Unauthorized** without a Clerk session. `validate-platform-integrity.mjs` already treated 401 as SKIP for `spx/desk`, `flows`, `nighthawk`, and `zerodte/board`, but **not** for the GEX/vector probes — empty JSON body + 401 was graded WARN.

## Fix

Shared `tierGatedStatus()` helper: HTTP 401 → SKIP `tier-gated` for `gex-positioning-spx`, `thermal-matrix-{SPY,QQQ}`, and `vector-spx-0dte-walls`.

## Evidence

- Before: lifecycle sweep 3 pass / **4 warn** / 0 fail (2026-09-04 ~14:57 UTC)
- After: `npm run validate:platform-integrity` → 3 pass / **0 warn** / 0 fail / 10 skip
