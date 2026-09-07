# Desk age: modest future skew must not yield negative seconds

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Priority** | P2 |
| **Area** | SPX play gates / desk staleness |
| **PR** | (this branch) |

## Symptom

When `polled_at` / `as_of` is clock-skewed up to 60s into the future, `spx-play-gates.ts` and
`spx-desk-stale.ts` computed a **negative** `deskStaleSec`. That never exceeded
`playGexStaleMaxSec()`, so entry gates treated skewed snapshots as live. `playbook-data-quality.ts`
already clamped with `Math.max(0, …)` — the two paths disagreed.

## Fix

- `spx-play-gates.ts`: clamp `polledAgeMs` and `gex_age_ms` lanes with `Math.max(0, …)` inside the
  future-tolerance window (fail-closed unchanged beyond tolerance).
- `spx-desk-stale.ts`: same clamp for open-play management age helper.

## Verify

- `npx tsx --test src/features/spx/lib/spx-desk-stale.test.ts`
- `npx tsx --test src/features/spx/lib/spx-play-gates.test.ts`
