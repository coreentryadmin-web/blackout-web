> **kind:** FINDING

## Swing play-brief: earnings evidence omitted days_until and report_time (C7) — FIXED

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Area** | Night Hawk Swings / Ask Largo |
| **Contract** | LARGO C7 (evidence) |

### Symptom

`catalystsSection()` narrated earnings proximity (`in 7 days`) and print timing (`AMC`), but `evidenceFromContext()` only emitted the calendar date — structured evidence could not ground proximity/timing claims.

### Fix

Forward `days_until` and `report_time` into the earnings evidence fact (same thresholds as catalysts section).

### Evidence

Regression assertions in `play-brief.test.ts` (earnings evidence test).
