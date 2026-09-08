> **kind:** FINDING

# Vector freshness: future `asOf` clamped to "live" — FIXED

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Area** | Largo / Vector |
| **Severity** | P2 — false-fresh disclosure |
| **PR** | (opening) |

## Symptom

`describeVectorFreshness()` clamped negative age (`Math.max(0, now - observed)`) and classified
`freshnessFromAgeMs(0)` as **`live`**. A snapshot stamped >5s ahead of the reader (clock skew
between cron writer and API reader) therefore read as live instead of unknown.

## Root cause

`src/lib/bie/vector-state-freshness.ts` lacked the `WS_TIMESTAMP_FUTURE_TOLERANCE_MS` guard used
everywhere else (`FreshnessChip`, `ageSecFromIso`, `admin-store-age`).

## Fix

Reject timestamps beyond tolerance → `freshness: "unknown"`, `age_seconds: null`, explicit note.
Within tolerance, keep clamp-to-zero behavior.

## Evidence

- `npx tsx --test src/lib/bie/vector-state-freshness.test.ts` — RED pre-fix on 30s skew, GREEN post-fix
- Blast radius: `fetchVectorFullState` consumers (Largo Vector tools, Cortex inputs, scenario-read)

## RTH validation

Off-hours only — re-check Vector desk freshness chip on a forced-stale snapshot during RTH if needed.
