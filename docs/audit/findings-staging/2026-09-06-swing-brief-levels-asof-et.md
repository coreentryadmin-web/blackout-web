# Swing play-brief BieLevel provenance shipped raw UTC ISO — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **ID** | swing-brief-levels-asof-et |
| **Pri** | P2 |
| **Area** | Ask Largo / Night Hawk Swings |
| **Status** | FIXED in `fix/swing-brief-levels-asof-et` |

## Symptom

`levelsFromContext()` stamped every `BieLevel.provenance.asOf` with raw `gex.asof` / `vec.asOf` UTC ISO strings while evidence rows already used `etStampFromIso()` (C1 violation). Cross-product level joins against Vector/Thermal reads that carry `as_of_et` could not align on the same clock.

## Fix

`levelProvenanceAsOf()` prefers `gex.as_of_et` / `vec.asOfEt`, falling back to `etStampFromIso()` on the raw ISO fields.

## Evidence

- New regression test: envelope level provenance must match `/ ET$/` and must not match raw `…Z` ISO.
- `play-brief.test.ts`: 15/15 pass locally.
