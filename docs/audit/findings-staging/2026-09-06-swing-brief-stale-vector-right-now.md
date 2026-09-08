> **kind:** FINDING

## Swing play-brief: stale Vector narrated as "Right now" — FIXED

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Area** | Night Hawk Swings / Ask Largo |
| **Contract** | LARGO C2 (freshness) |

### Symptom

`dealerPostureLine()` always led with **"Right now"** even when the Vector snapshot was stale (`dataAgeMs > 120s` or `freshness === "stale"`). Structured absence and `dataHonestyCoaching()` correctly flagged staleness elsewhere — the lead posture bullet still read as a live read.

### Fix

Qualify the lead-in: **"Last snapshot (~Ns old)"** when Vector is stale; keep **"Right now"** only on fresh reads.

### Evidence

Regression test in `play-brief-narrative.test.ts`.
