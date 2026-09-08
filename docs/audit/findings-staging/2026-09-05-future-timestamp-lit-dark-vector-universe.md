# Future-timestamp guards — lit/dark ratio + Vector universe staleness — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **ID** | BO-P2-future-ts-lit-dark-vector |
| **Priority** | P2 |
| **Status** | FIXED (pending merge) |
| **Area** | SPX desk lit/dark ratio, Vector universe age chips |

## Symptom

Two remaining `Date.now() - updatedAt` freshness reads without the shared future-timestamp guard:

1. `computeLitDarkRatio()` treated clock-skewed future `litTradesStore.updatedAt` / `darkPoolStore.updatedAt` as fresh, serving SPX desk `lit_dark_ratio` from untrusted timestamps.
2. `VectorScanner` / `VectorTickerComparisonStrip` never flipped `isStale` when `data.updatedAt` was far in the future (negative age), hiding the stale warning chip while `formatVectorAge` clamped display to `"0s"`.

## Fix

- `uw-lit-dark-ratio.ts`: gate lit/dark freshness through `isWsUpdatedAtFresh`.
- `vector-age-format.ts`: add `isVectorUniverseSnapshotStale()` (inverse of `isWsUpdatedAtFresh` with `VECTOR_UNIVERSE_STALE_MS`).
- Wire both Vector consumers to the shared helper.

## Regression tests

- `src/lib/uw-lit-dark-ratio.test.ts`
- `src/features/vector/lib/vector-age-format.test.ts`

## RTH validation

Off-hours only — no live RTH signal expected. At next open, confirm Vector scanner age chip still turns amber after ~10m without a cron rebuild; SPX desk lit/dark ratio absent when UW stores carry only future `updatedAt` (synthetic only).
