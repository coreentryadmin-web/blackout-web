# 2026-09-05 — Vector freshness future-skew false-live

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Severity** | P1 |
| **Area** | Vector BIE freshness disclosure, Vector play conviction |
| **Status** | FIXED |

## Symptom

`describeVectorFreshness` clamped `Math.max(0, now - observedAt)` so a snapshot stamped 30s in the future reported `age_seconds: 0` and `freshness: "live"`. `withReadContext` in `vector-full-state.ts` applied the same clamp to `dataAgeMs`, zeroing the conviction staleness discount on clock-skewed cache entries.

## Root cause

Comment in `vector-state-freshness.ts` intentionally clamped negative age to avoid "fresher than live" display, but `freshnessFromAgeMs` already returns `"unknown"` for negative ages — the clamp prevented that path and routed future skew into `"live"` instead.

## Fix

- Fail-closed to `freshness: "unknown"` when `ageMs < -WS_TIMESTAMP_FUTURE_TOLERANCE_MS` (5s), matching SPX desk GEX (#3937) and `ageSecFromIso`.
- Within tolerance, keep `Math.max(0, ageSec)` for display only; classifier uses raw `ageMs`.
- `withReadContext`: pass `dataAgeMs: null` when future beyond tolerance so play conviction does not treat skew as fresh.

## Evidence

- `vector-state-freshness.test.ts` — future +30s → unknown; +2s within tolerance → live.
- Pattern scan from hourly checklist §3 (2026-09-05 autopilot wake).

## RTH validation

- Poll Largo `get_vector_pulse` / desk brief for a ticker during RTH — `freshness` block should never read `"live"` when `observed_at` is materially ahead of reader clock.
- Vector terminal play conviction should discount on genuinely stale cache, not on future-skewed `asOf`.
