# Flow tape age false-fresh on future alerted_at — FIXED

> **kind:** FINDING

| **Status** | FIXED (pending merge) |
|------------|-------------------------|
| **Priority** | P1 |
| **Area** | SPX desk / flow_data_age_ms |
| **PR** | fix/flow-data-freshness-future-guard |

## Symptom

`resolveFlowDataAgeMs()` could report `flow_data_age_ms = 0` when the newest HELIX tape row had a future `alerted_at`, falsely reading the flow channel as live for SPX play gates.

## Root cause

`newestFlowAgeMsFromBriefs` and `flowDataAgeMs` used `Math.max(0, now - t)` without the future guard already applied on writes in `markFlowDataFresh`.

## Fix

Added `flowTimestampAgeMs()` using `WS_TIMESTAMP_FUTURE_TOLERANCE_MS`; wired both read paths through it.

## Evidence

`npx tsx --test src/lib/flow-data-freshness.test.ts` — far-future case returns `null`.

## RTH validation

During RTH, confirm SPX desk `flow_data_age_ms` does not read `0` when tape rows carry clock-skewed future `alerted_at` (should fail closed / null age).
