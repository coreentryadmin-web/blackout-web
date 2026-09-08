# SPX play gate: future-skewed gex_age_ms bypassed stale block

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **ID** | BO-P2-2026-09-05-gex-age-future-gate |
| **Priority** | P2 |
| **Area** | SPX Slayer / play gates |
| **Status** | FIXED |

## Symptom

When `desk.gex_age_ms` was negative beyond `WS_TIMESTAMP_FUTURE_TOLERANCE_MS` (clock-skewed future `pos.asof`), `gexStaleFromAge()` correctly marked `gex_stale: true` on the desk pill — but `evaluatePlayGates()` converted the raw negative age to a negative `gexSec`, which never exceeded `playGexStaleMaxSec()`. A desk with a lit GEX-stale pill could still open plays if `polled_at` was fresh.

## Root cause

`spx-play-gates.ts` applied a future-timestamp fail-closed guard to `polled_at` (2026-09-03 fix) but left `gex_age_ms` as a raw `ageMs / 1000` without the same guard.

## Fix

Apply the same fail-closed pattern: when `gex_age_ms < -WS_TIMESTAMP_FUTURE_TOLERANCE_MS`, treat as `playGexStaleMaxSec() + 1` (aligned with `gexStaleFromAge`).

## Regression test

`src/features/spx/lib/spx-play-gates.test.ts` — "future-skewed gex_age_ms blocks entry even when polled_at is fresh"

## Market-open validation

During RTH, if GEX snapshot shows stale pill on SPX desk, confirm play rail does not surface new BUY entries for the same desk snapshot.
