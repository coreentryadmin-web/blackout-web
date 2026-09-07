# Largo C3 — prior-session Night Hawk missing from unavailableSources

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Area** | Ask Largo / swing play-brief |
| **PR** | (this branch) |

## Symptom

After #4427 gated `nighthawkLiveForSession()` in cross-desk prose, consumers reading only `envelope.unavailableSources` / `UnavailableChip` still saw no structured absence when `nighthawk_recent.edition_for` lagged `ctx.sessionDate` — the same C3 gap #4428 closes for 0DTE.

## Fix

Emit `{ source: "Night Hawk swings", reason: "prior session (…) — today's edition not yet published" }` in `collectBriefUnavailableSources()` when edition date mismatches.

## Verify

`npx tsx --test src/lib/swing/play-brief-absence.test.ts` — prior-session + same-day negative cases.
