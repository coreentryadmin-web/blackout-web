# Largo swing brief — stale Vector chart/level fields still read as live (Largo C2)

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Priority** | P1 |
| **Area** | Ask Largo / swing play-brief |
| **PR** | (pending) |

## What was broken

After the recent GEX-wall and Vector `play.bias` staleness gates (#4376–#4394), three classes of Vector/GEX fields still grounded directional coaching while `unavailableSources` also flagged the snapshot as stale:

1. **Chart technicals** — `chartTechnicalsSection` and `technicalsCoaching` still badged bullish/bearish and coached alignment from a >120s Vector snapshot.
2. **Vector-only levels** — `chartLevelsSection` and `collectFocalLevels` still narrated max pain, expected move, dark pool, and confluence from stale Vector.
3. **GEX posture numerics** — `gexPostureSection` suppressed `gamma_posture` when stale but still printed net GEX / nearest wall / session change.

## Fix

Gate with existing `vectorSnapshotStale()` / `gexMatrixStale()` helpers — same pattern as `vectorDeskSection` (#4387) and `evidenceFromContext`.

## Validate at RTH

Open a swing play brief on a ticker where Vector cache is >2min old (off-hours is fine): chart technicals badge should be neutral, coaching should not claim "chart reads bullish/bearish", GEX posture section should show only the staleness disclaimer.
