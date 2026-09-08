# Swing play-brief dark pool level provenance mislabeled HELIX — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Status** | FIXED in PR (pending) |
| **Priority** | P2 |
| **Area** | Night Hawk Swings / Ask Largo |
| **Contract** | LARGO C8 (provenance) |

## Symptom

`composeSwingPlayBrief()` stamped Vector-sourced dark pool strikes in `envelope.levels` with `provenance.source: "HELIX"` while adjacent confluence/max-pain levels from the same `ctx.vector` snapshot correctly read `"Vector"`.

## Root cause

Copy-paste inconsistency in `levelsFromContext()` — dark pool rows reuse Vector freshness/`asOf` but hardcoded `"HELIX"` as source. Data originates from `getVectorDarkPoolLevels()` in Vector full-state, not HELIX flow tape.

## Fix

Change dark pool level `provenance.source` from `"HELIX"` → `"Vector"`. Regression test asserts source on composed brief.

## RTH validation

On a live swing with Vector dark pool levels, open Ask Largo → level table / SourceStamp for dark pool row should show **Vector**, not HELIX.
