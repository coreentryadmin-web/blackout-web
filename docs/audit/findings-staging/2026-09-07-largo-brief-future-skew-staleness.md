# Largo swing brief: future-skewed timestamps read as fresh — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **ID** | BO-P1-largo-skew-stale |
| **Severity** | P1 |
| **Area** | Ask Largo / Night Hawk Swings (`play-brief-absence.ts`) |
| **Status** | FIXED |

## Symptom

`gexMatrixStale()` and `vectorAgeStale()` in the swing play-brief absence layer did not fail-closed on clock-skewed future timestamps. A future `gex.asof` or `vector.asOf` produced negative age → not stale → dealer posture and Vector levels still drove Ask Largo narrative while provenance said unknown.

## Root cause

- `gexMatrixStale`: compared `ageMs > 120_000` only — no `WS_TIMESTAMP_FUTURE_TOLERANCE_MS` guard (unlike `gexStaleFromAge` on SPX desk).
- `vectorAgeStale`: skipped `dataAgeMs === POSITIVE_INFINITY` (finite check), ignored `freshness === "unknown"`, and raw `asOf` fallback had no future guard.

## Fix

Mirror SPX desk / `FreshnessChip` fail-closed semantics in `play-brief-absence.ts`; regression tests in `play-brief-absence.test.ts`.

## Blast radius

Ask Largo swing brief only — GEX matrix staleness gating, Vector snapshot staleness gating, `resolveGammaPosture`, `collectBriefUnavailableSources`.
