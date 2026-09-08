# Night Hawk + Vector future-timestamp age fail-closed — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **ID** | BO-P2-future-timestamp-age |
| **Status** | FIXED |
| **Area** | Night Hawk command deck + Vector BIE play conviction |
| **PR** | (opening) |

## Symptom

Clock-skewed future `first_at` / `asOf` timestamps clamped to age `0`, reading as "just fired" / fresh conviction instead of stale or unknown.

## Root cause

- `eventAgeMs()` in `play-card-lifecycle.ts` returned `delta >= 0 ? delta : 0` — any future stamp became age 0.
- `withReadContext()` in `vector-full-state.ts` used `Math.max(0, Date.now() - observedAt)` while `describeVectorFreshness()` correctly marked far-future as `unknown` — split brain on the same snapshot.

## Fix

Both paths now use `WS_TIMESTAMP_FUTURE_TOLERANCE_MS` (5s): within tolerance → `Math.max(0, rawAgeMs)`; beyond → `Number.POSITIVE_INFINITY` so Night Hawk tier reads `late` and Vector `stalenessConvictionDiscount` applies maximum penalty.

## Evidence

- `npx tsx --test` play-card-lifecycle.test.ts (future 30s → tier `late`, no pulse)
- vector-state-freshness.test.ts source scan + vector-play-engine stalenessConvictionDiscount test
