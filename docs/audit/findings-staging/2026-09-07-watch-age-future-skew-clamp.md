# WATCH promotion: modest future skew must not yield negative age minutes

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Priority** | P2 |
| **Area** | SPX WATCH→ENTRY promotion |
| **PR** | (this branch) |

## Symptom

When a WATCH record's `first_at` is clock-skewed within `ZERODTE_MARK_FUTURE_TOLERANCE_MS`
into the future, `checkPromoteEligibility` computed a **negative** `ageMin`. That never
exceeded `maxAge`, so the record appeared perpetually young instead of being treated as
just-started (0 min). Beyond-tolerance future stamps were already fail-closed; the within-
tolerance band disagreed with the same `Math.max(0, …)` clamp shipped in #4563 for desk age.

## Fix

- `spx-play-watch.ts`: clamp `ageMin` with `Math.max(0, ageMs / 60_000)` after the existing
  beyond-tolerance fail-closed guard.

## Verify

- `npx tsx --test src/features/spx/lib/spx-play-watch-freshness.test.ts`
