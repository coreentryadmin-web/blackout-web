> **kind:** FINDING

## Swing play-brief: prior-session discovery scan not flagged — FIXED

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Area** | Night Hawk Swings / Ask Largo |
| **Contract** | LARGO C3 (absence) |

### Symptom

`scanSessionDay` is loaded from the serving snapshot but never compared to the brief's `sessionDate`. A WATCH row from yesterday's scan still showed a scan timestamp with no staleness warning and no structured `unavailableSources` entry — discovery looked current when it was not.

### Fix

`collectBriefUnavailableSources()` emits a structured C3 entry when `scanSessionDay !== sessionDate`. `dataFreshnessSection()` and `dataHonestyCoaching()` now narrate the same fact in prose.

### Evidence

Regression tests in `play-brief-absence.test.ts`, `play-brief-intel.test.ts`, and `play-brief-narrative-coaching.test.ts`.
