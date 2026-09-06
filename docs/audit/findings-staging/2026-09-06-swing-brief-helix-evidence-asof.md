# Swing play-brief HELIX flow evidence missing asOf — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Status** | FIXED in PR (pending) |
| **Priority** | P2 |
| **Area** | Night Hawk Swings / Ask Largo |
| **Contract** | LARGO C1 (time) |

## Symptom

`evidenceFromContext()` stamped HELIX flow facts with `provenance.freshness: "live"` but no `asOf`, while mark and scan evidence in the same function already carry ET `asOf`.

## Fix

Add `asOf: ctx.asOf` to HELIX flow evidence provenance (brief read is already ET-stamped).

## RTH validation

Ask Largo on a play with HELIX flow → evidence row provenance should include ET asOf matching brief read time.
