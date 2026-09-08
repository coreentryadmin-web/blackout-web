# 2026-09-06 — Stale Vector play bias steelmanned in Largo counter-thesis

> **kind:** FINDING

| Field | Value |
|---|---|
| **Status** | FIXED |
| **Severity** | P2 |
| **Area** | Night Hawk Swings / Ask Largo |
| **Contract** | Largo C2 (freshness) |

## Symptom

`counterThesisLine()` cited **Vector bearish/bullish** desk play bias even when the Vector snapshot was stale (`freshness: "stale"` or `dataAgeMs > 120s`). Same class of defect already fixed for GEX-only walls (#4364) and dealer posture (#4355/#4360).

## Root cause

Vector `play.bias` was appended to counter-thesis reasons without a staleness gate, while HELIX flow, GEX walls, and GEX posture already had one.

## Fix

- Export shared `vectorSnapshotStale()` in `play-brief-absence.ts`
- Gate Vector play bias in `counterThesisLine()`
- Regression test in `play-brief-narrative.test.ts`

## Verify at RTH

Open a swing row on `/nighthawk` Swings tab → Ask Largo → confirm counter-thesis does not cite Vector desk bias when Vector snapshot chip shows stale.
