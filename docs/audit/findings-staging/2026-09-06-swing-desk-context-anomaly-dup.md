# Swing play brief — desk context duplicated flow anomalies

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Area** | Night Hawk Swings / Ask Largo play-brief |
| **PR** | (this branch) |

## Symptom

When Trade manager read narrative was present, members could still see the same HELIX flow anomaly three times: once in the narrative bullet (`flowNarrative`), again in the collapsed-but-still-visible **Desk context** section, and in **Flow & positioning** before collapse.

Additionally, `NARRATIVE_COVERED_TITLES` listed **Desk consensus** but the section title is **Desk context**, so the collapse map never matched.

## Root cause

`deskConsensusSection` appended `recent_anomalies[0]` even though `flowNarrative` already appends the same anomaly to Trade manager read, and `flowIntelSection` lists all anomalies under Flow & positioning.

## Fix

- `deskConsensusSection` now renders **only** Night Hawk outcome history (unique vs `crossDeskCoaching`).
- Removed stale **Desk consensus** entry from collapse allowlist (wrong title).
- Tests: anomaly-only → null; Desk context survives narrative collapse when present.

## RTH validation

On an OPEN swing with a recent HELIX anomaly: Trade manager read should mention the anomaly once; **Desk context** should appear only when NH outcome history exists, never for anomaly-only.
