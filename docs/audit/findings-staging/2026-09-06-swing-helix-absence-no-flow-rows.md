# Swing Ask Largo — HELIX pipeline-down missing from unavailableSources

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **PR** | fix/swing-helix-absence-no-flow-rows |
| **Area** | Ask Largo / swing play-brief |
| **Contract** | Largo C3 (absence) |

## Symptom

When `fetchEcosystemContext` fails or the HELIX pipeline is down, `emptyContext()` returns `recent_flow: null` and `flow_feed_fresh: false`. Ask Largo prose could still caveat via `dataHonestyCoaching`, but `envelope.unavailableSources` stayed empty — `UnavailableChip` never fired.

## Root cause

`collectBriefUnavailableSources` required `recent_flow` truthy before pushing the HELIX stale source. The guard only covered stale cached rows, not pipeline-down with no rows.

## Fix

Surface `HELIX flow · pipeline stale` whenever `flow_feed_fresh === false`, regardless of `recent_flow`.

## Evidence

`npx tsx --test src/lib/swing/play-brief-absence.test.ts` — new test fails pre-fix, passes post-fix.
