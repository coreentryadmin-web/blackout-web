# FreshnessChip future-timestamp false-live — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Severity** | P2 |
| **Area** | FreshnessChip / desk live badges |
| **PR** | (pending) |

## Symptom

`FreshnessChip` with `status="live"` and a clock-skewed future `asOf` stayed **Live** — `effectiveStatus` only checked `now - asOf > staleAfterMs`, never the negative-age case. Same class as GEX matrix freshness and LULD halt guards.

## Fix

Extract `effectiveFreshnessStatus()` — future skew beyond `WS_TIMESTAMP_FUTURE_TOLERANCE_MS` (5s) → `stale`.

## Tests

`FreshnessChip.freshness.test.ts` — 10s future → stale; 3s future → live.
