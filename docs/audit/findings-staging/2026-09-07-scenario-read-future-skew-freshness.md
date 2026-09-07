# Scenario-read future-skew freshness — FIXED

> **kind:** FINDING

| **Status** | FIXED in fix/scenario-read-future-skew-freshness |
|------------|--------------------------------------------------|

## Symptom

`buildScenarioEnvelope()` stamped Vector scenario provenance via `freshnessFromAgeMs(Date.now() - Date.parse(state.asOf))` without the `WS_TIMESTAMP_FUTURE_TOLERANCE_MS` guard already on swing brief paths (#4454/#4455). A clock-skewed future `asOf` read as **unknown** instead of fail-closed **stale** (Largo C2).

## Root cause

Same defect class as option-mark provenance (#4455): raw age subtraction into `freshnessFromAgeMs`, which maps negative age to `"unknown"`.

## Fix

- Hoist shared `freshnessFromObservedMs()` to `answer-envelope.ts`
- Wire scenario-read provenance through it; dedupe play-brief local copy
- Regression tests in `answer-envelope.test.ts` and `scenario-read.test.ts`

## RTH validation

Ask Largo a Vector what-if scenario during RTH; provenance on a healthy snapshot should read `live`/`recent`, not `STALE` or `age unknown`.
