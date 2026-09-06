> **kind:** FINDING

## Swing play-brief: Meridian peer beat rates missing from envelope evidence — FIXED

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Area** | Night Hawk Swings / Ask Largo |
| **Contract** | LARGO C7 (evidence) |

### Symptom

`meridianPeerEarningsCoaching()` narrated peer beat rates (e.g. `ULTA 75% beat (n=4)`) in Trade manager read, but `evidenceFromContext()` never pushed cohort-scoped facts — structured evidence rail could not ground peer-history claims.

### Fix

Add `meridianPeerEvidenceText()` and emit Meridian peer cohort facts in `evidenceFromContext()` when an earnings catalyst is within 14d and peer cohort is available.

### Evidence

Regression tests in `play-brief-meridian-peer.test.ts` and `play-brief.test.ts`.
