# Desk context narrated prior-session Night Hawk outcome — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **ID** | BO-P2-desk-consensus-prior-session |
| **Severity** | P2 |
| **Area** | Ask Largo / Night Hawk Swings play-brief |
| **Status** | FIXED (pending merge) |

## Symptom

When `nighthawk_recent.edition_for` lagged the brief's `sessionDate`, the envelope correctly surfaced an unavailable chip (`Night Hawk swings — prior session …`) but the **Desk context** intel section still narrated that stale outcome as actionable cross-desk context ("weigh that track record against today's setup").

## Root cause

`deskConsensusSection()` read `eco.nighthawk_recent` directly without the session gate already used by `crossDeskCoaching` (`nighthawkLiveForSession`) and `collectBriefUnavailableSources`.

## Fix

Gate `deskConsensusSection` with `nighthawkLiveForSession(nh, sessionDate)` and pass `ctx.sessionDate` from `buildIntelSections`.

## Evidence

- RED→GREEN: `play-brief-intel.test.ts` — prior-session edition returns null when sessionDate mismatches.
- Largo contract: C2 (freshness) + C3 (absence) — stale data must not read as live signal in prose.
