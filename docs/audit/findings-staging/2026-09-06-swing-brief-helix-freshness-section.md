> **kind:** FINDING

## Swing play-brief: HELIX pipeline staleness missing from Data freshness section — FIXED

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Area** | Night Hawk Swings / Ask Largo |
| **Contract** | LARGO C2 (freshness) + C3 (absence) |

### Symptom

When `ecosystem.flow_feed_fresh === false`, staleness was already surfaced in `collectBriefUnavailableSources()` and `dataHonestyCoaching()`, but `dataFreshnessSection()` stayed silent if mark, scan, and Vector were all fine — the brief had no Data freshness section at all despite a stale HELIX pipeline.

### Fix

`dataFreshnessSection()` now adds a HELIX pipeline stale line when `flow_feed_fresh === false`, matching the triple-channel pattern used for mark sync and prior-session discovery scan.

### Evidence

Regression test in `play-brief-intel.test.ts`.
