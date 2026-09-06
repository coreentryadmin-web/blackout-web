> **kind:** FINDING

## Swing play-brief: HELIX flow evidence omitted premium dollars (C7) — FIXED

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Area** | Night Hawk Swings / Ask Largo |
| **Contract** | LARGO C7 (evidence) |

### Symptom

`flowIntelSection` narrated call/put premium totals and bias, but `buildBriefEvidence()` only emitted print count — the structured evidence rail could not ground dollar claims.

### Fix

Extend HELIX flow evidence text to include bias label and call/put premium totals (same thresholds as intel section).

### Evidence

Regression assertions in `play-brief.test.ts` (HELIX flow evidence test).
