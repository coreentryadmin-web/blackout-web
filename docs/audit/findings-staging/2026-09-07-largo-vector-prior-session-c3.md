# Largo Vector prior-session absence not surfaced in unavailableSources (C3)

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Area** | Night Hawk / Ask Largo swing play-brief |
| **Contract** | LARGO C3 (absence) |
| **PR** | (pending) |

## Symptom

`vectorSnapshotStale()` only checked age (120s). A sub-120s Vector snapshot measured in a **prior** ET session could still drive chart levels, cross-desk coaching, and gamma posture while `unavailableSources` / `UnavailableChip` showed nothing wrong.

## Root cause

`describeVectorFreshness` ships `observed_session_date` for exactly this comparison, but swing brief gates never compared it to `ctx.sessionDate`. Same class of gap closed for 0DTE (#4428) and Night Hawk (#4434).

## Fix

- `vectorObservedSessionDate`, `vectorAgeStale`, `vectorLiveForSession`
- `vectorSnapshotStale(vec, readMs, briefSessionDate?)` — age OR prior-session mismatch
- `collectVectorStalenessAbsence` emits `prior session (…) — today's desk read not yet run`
- All narrative/coaching/intel call sites pass `ctx.sessionDate`

## Evidence

`npx tsx --test src/lib/swing/play-brief-absence.test.ts` — 34/34 pass (3 new cases).
