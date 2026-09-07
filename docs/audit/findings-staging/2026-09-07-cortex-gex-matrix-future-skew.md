# Cortex + GEX matrix_age_sec future-skew gaps — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **ID** | BO-P1-cortex-gex-matrix-future-skew |
| **Priority** | P1 |
| **Area** | Night Hawk Cortex / Largo GEX freshness |
| **Status** | FIXED |

## Symptom

Hourly bug-discovery sweep found two remaining future-skew holes after the Sep 7 Largo C2 wave (#4472–#4474):

1. **Cortex** (`compose.ts:159`) used `Math.max(0, (nowMs - asOfMs) / 1000)` — any future `asOf` (even hours ahead) clamped to `ageSec = 0` and entered decay at full weight.
2. **`matrix_age_sec`** in `getGexPositioning()` and `gex-heatmap-for-largo.ts` still called legacy `ageSecondsFromIso` instead of canonical `ageSecFromIso`, diverging from #4472 on 1–5s skew paths.

## Fix

- Cortex: derive age via `ageSecFromIso`; demote to `absent` when null.
- GEX paths: swap to `ageSecFromIso`; delegate `et-session-facts.ageSecondsFromIso` to the canonical helper.
- `gexMatrixAgeMs` fallback uses `ageSecFromIso` when `matrix_age_sec` is absent.

## Evidence

- RED→GREEN: new `compose.test.ts` case — 1h-future wall-trend absent, not supporting.
- `npx tsx --test` on compose, et-session-facts, play-brief-absence suites.
