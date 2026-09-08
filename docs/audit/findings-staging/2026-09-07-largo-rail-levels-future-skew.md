> **kind:** FINDING

## Largo rail-levels `readAgeSeconds` — future-skewed asof reads as 0s fresh (Largo C2) — FIXED

| Field | Value |
|-------|-------|
| **Status** | FIXED in `fix/largo-rail-levels-future-skew` |
| **Priority** | P2 |
| **Area** | Largo desk rail level ladder |

### Symptom

`readAgeSeconds` in `src/features/largo/lib/rail-levels.ts` used `Math.max(0, now - t)` — a clock-skewed-future `as_of` stamp rendered as **0 seconds old** instead of unusable.

### Root cause

Local age helper did not apply `WS_TIMESTAMP_FUTURE_TOLERANCE_MS` fail-closed semantics (same class as #4472 / Largo C2).

### Fix

Delegate `readAgeSeconds` to shared `ageSecFromIso` from `@/lib/ws/timestamp-freshness`.

### Verify at RTH

Open Largo desk rail with a level ladder — confirm stale chip does not show "0s" on skewed timestamps.
