> **kind:** FINDING

## Swing play-brief: stale HELIX mislabeled "quiet" in dataHonestyCoaching — FIXED

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Area** | Night Hawk Swings / Ask Largo |
| **Contract** | LARGO C3 (absence) |

### Symptom

When `flow_feed_fresh === false`, `dataHonestyCoaching()` said "HELIX feed quiet — flow read may lag" while structured `unavailableSources` and `dataFreshnessSection()` correctly labeled the pipeline **stale** — "quiet" implies no signal; stale implies unknown/untrusted.

### Fix

Align coaching copy with structured absence: "HELIX pipeline stale — flow read unavailable, not evidence of quiet tape".

### Evidence

Regression test in `play-brief-narrative-coaching.test.ts`.
